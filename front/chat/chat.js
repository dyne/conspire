////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
import { formatChatAnnouncement, humanFileSize, insertTextAtSelection } from './format.js';
import { createFileChunkMessage } from './protocol.js';
import { createChatState } from './state.js';

const { urlWebsocket, urlRoom } = globalThis.ConspireChatConfig;
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

let CODE_INFO = 0;
let CODE_PEER_JOINED = 1;
let CODE_PEER_LEFT = 2;
let CODE_PEER_MESSAGE = 3;
let CODE_PEER_MESSAGE_FILE = 4;
let CODE_PEER_IS_TYPING = 5;

let CODE_FILE_SHARE = 6;
let CODE_FILE_REQUEST_CHUNK = 7;

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

let socket = new WebSocket(urlWebsocket);
let protocolModule = import(urlRoom + "/protocol.js");
let peerId = null;
let peerName = null;
let peersMap = new Map();
const chatState = createChatState();
let filesMap = chatState.files;
let bulbColorsNumber = 18;
let socketSendBuffer = [];
let lastTimeTypingSent = 0;
let hydratingHistory = false;

setupEmoji();

function nextFileId() {
    return chatState.nextFileId ++;
}

function announceActivity(type, details) {
    if (hydratingHistory) return;
    const region = document.getElementById('chat_activity');
    if (region) region.textContent = formatChatAnnouncement(type, details);
}

function setupEmoji (){

    const controls = document.querySelectorAll('#emoji button[data-emoji]');
    for (const child of controls) {
        child.addEventListener('click', function() {
            let input = document.getElementById('chat_input');
            insertTextAtSelection(input, child.dataset.emoji);
            input.focus();
        });
    }
}

function messageGroup(message, peerKey = message.peerId) {
    const messageField = document.getElementById('chat_history');
    const lastChild = messageField.lastElementChild;
    if (lastChild?.dataset.peerId === String(peerKey)) return lastChild;
    const group = document.createElement('article');
    group.className = 'message-container';
    group.dataset.peerId = peerKey;
    const author = document.createElement('p');
    const timestamp = new Date(message.timestamp / 1000);
    author.className = 'message-author';
    author.textContent = message.peerName + ' at ' + timestamp.toLocaleTimeString([], { timeStyle: 'short' });
    const time = document.createElement('time');
    time.dateTime = timestamp.toISOString();
    time.textContent = author.textContent;
    author.replaceChildren(time);
    group.setAttribute('aria-label', `Messages from ${message.peerName} at ${time.textContent}`);
    group.append(author);
    messageField.append(group);
    return group;
}

function postChatMessage(message) {

    removeTypingPeerNow(message.peerId);

    let messageField = document.getElementById('chat_history');
    let scrollPos = messageField.scrollHeight - messageField.scrollTop;
    const messageElem = messageGroup(message);

    let messageDiv = document.createElement('div');
    messageDiv.className = "message-div";

    let bulb = document.createElement('div');
    bulb.className = "message-bulb";

    let messageText = document.createElement('pre');
    messageText.className = "message-text";
    messageText.textContent = message.message;

    bulb.append(messageText);
    messageDiv.append(bulb);
    messageElem.append(messageDiv);

    if(scrollPos <= messageField.getBoundingClientRect().height) {
        messageField.scrollTop = messageField.scrollHeight;
    }
    announceActivity('message', message);

}

function postSharedFile(message) {

    let messageField = document.getElementById('chat_history');
    let scrollPos = messageField.scrollHeight - messageField.scrollTop;
    const messageElem = messageGroup(message);

    let messageDivFiles = document.createElement('div');
    messageDivFiles.className = "message-div-files";

    for(let i = 0; i < message.files.length; i ++) {

        let file = message.files[i];

        let fileInfoSize = document.createElement('p');
        fileInfoSize.className = "file-info-size";
        fileInfoSize.textContent = "Size: " + humanFileSize(file.size);

        let link = document.createElement('a');
        var linkText = document.createTextNode(file.name);
        link.appendChild(linkText);
        link.href = urlRoom + "/file/" + file.serverFileId;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        let messageDivOneFile = document.createElement('div');
        messageDivOneFile.className = "message-div-file";

        messageDivOneFile.append(link);
        messageDivOneFile.append(fileInfoSize);

        if (message.peerId == peerId) {
            let fileInfoSent = document.createElement('pre');
            fileInfoSent.className = "file-info-size";
            fileInfoSent.id = "file_served_" + file.serverFileId;
            fileInfoSent.textContent = "Sent: " + humanFileSize(0, 0);
            fileInfoSent.setAttribute("amount-sent", "0");
            fileInfoSent.setAttribute("progress-spin", "0");
            messageDivOneFile.append(fileInfoSent);

        }

        messageDivFiles.append(messageDivOneFile);

    }

    messageElem.append(messageDivFiles);

    if(scrollPos <= messageField.getBoundingClientRect().height) {
        messageField.scrollTop = messageField.scrollHeight;
    }
    announceActivity('file', { peerName: message.peerName, count: message.files.length });

}

function postSystemMessage(message) {

    removeTypingPeerNow(message.peerId);

    let messageField = document.getElementById('chat_history');
    let scrollPos = messageField.scrollHeight - messageField.scrollTop;
    const messageElem = messageGroup({ ...message, peerName: 'Room activity', timestamp: message.timestamp || Date.now() * 1000 }, 'sys');

    let messageDiv = document.createElement('div');
    messageDiv.className = "message-div-system";

    let messageText = document.createElement('pre');
    messageText.className = "message-text";
    messageText.textContent = message.message;

    messageDiv.append(messageText);
    messageElem.append(messageDiv);

    if(scrollPos <= messageField.getBoundingClientRect().height) {
        messageField.scrollTop = messageField.scrollHeight;
    }

}

function postPeerIsTyping(message) {

    if(message.peerId == peerId) {
        return;
    }

    let typingPeerElem = document.getElementById('typing_peer_' + message.peerId);
    if(typingPeerElem && typingPeerElem.classList.contains("typing_peer_removed")) {
        typingPeerElem.remove();
        typingPeerElem = null;
    }
    if(!typingPeerElem) {
        let whosTypingPanel = document.getElementById('chat_whos_typing');
        typingPeerElem = document.createElement('pre');
        typingPeerElem.id = 'typing_peer_' + message.peerId;
        typingPeerElem.className = "typing_peer";
        typingPeerElem.textContent = message.peerName + "   ";
        typingPeerElem.dataset.peerName = message.peerName;
        whosTypingPanel.append(typingPeerElem);
        announceActivity('typing', message);
    }

    let ts = new Date();
    typingPeerElem.setAttribute("typing_timestamp", ts.getTime());

}

function removeTypingPeerNow(typingPeerId) {
    let typingPeerElem = document.getElementById('typing_peer_' + typingPeerId);
    if(typingPeerElem) {
        announceActivity('stoppedTyping', { peerName: typingPeerElem.dataset.peerName });
        typingPeerElem.remove();
    }
}

function removeTypingPeer(peerElem) {
    peerElem.classList.add("typing_peer_removed");
    let removed = false;
    const finish = () => {
        if (removed) return;
        removed = true;
        announceActivity('stoppedTyping', { peerName: peerElem.dataset.peerName });
        peerElem.remove();
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finish();
        return;
    }
    peerElem.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 400);
}

let animateWhosTyping = setInterval(function() {

    let whosTypingPanel = document.getElementById('chat_whos_typing');
    let peers = whosTypingPanel.children;
    let now = (new Date()).getTime();

    for(let i = 0; i < peers.length; i++) {
        let peer = peers[i];
        let timestamp = parseInt(peer.getAttribute("typing_timestamp"));
        if(timestamp + 5000 < now) {
            removeTypingPeer(peer);
        } else {
            let text = peer.textContent;
            if(text.endsWith("...")) {
                peer.textContent = text.replace("...", "   ");
            } else if(text.endsWith("   ")) {
                peer.textContent = text.replace("   ", ".  ");
            } else if(text.endsWith(".  ")) {
                peer.textContent = text.replace(".  ", ".. ");
            } else if(text.endsWith(".. ")) {
                peer.textContent = text.replace(".. ", "...");
            }
        }
    }

}, 500);

function createParticipantElement(peer) {
    let peerElem = document.createElement('div');
    peerElem.id = "peer_" + peer.peerId;
    peerElem.setAttribute("peer_id", peer.peerId);
    peerElem.className = "participant";
    if(peer.peerId == peerId) {
        peerElem.classList.add("participant_self");
    } else {
        peerElem.classList.add("peer_style_" + (peer.peerId % bulbColorsNumber));
    }
    let span = document.createElement('span');
    span.textContent = peer.peerName;
    peerElem.append(span);
    return peerElem;
}

function removeParticipantElement(peerElem) {
    let removed = false;
    const finish = () => {
        if (removed) return;
        removed = true;
        peerElem.remove();
    };
    peerElem.classList.add("participant_deleted");
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finish();
        return;
    }
    peerElem.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 400);
}

function addParticipant(peer, parent) {
    parent.append(createParticipantElement(peer));
}

function cmpPeers(a, b) {
    if(a.peerName < b.peerName) { return -1; }
    if(a.peerName > b.peerName) { return 1; }
    return 0;
}

function createParticipantsList() {
    const list = document.getElementById('chat_participants');
    const heading = list.querySelector('#participants_heading');
    const allPeersElem = document.createElement('div');

    let caption = document.createElement('p');
    caption.id = 'participant_drawer_count';
    caption.textContent = "Participants: " + peersMap.size;
    caption.className = "participant_n";
    allPeersElem.append(caption);

    let peer = new Object();
    peer.peerId = peerId;
    peer.peerName = peerName;
    addParticipant(peer, allPeersElem);

    allPeersElem.append(document.createElement('hr'));

    let otherPeersElem = document.createElement('div');
    otherPeersElem.id = "peers_other";
    allPeersElem.append(otherPeersElem);

    let peers = Array.from(peersMap.values());
    peers.sort(cmpPeers);

    for (let index = 0; index < peers.length; index++) {

        let peer = peers[index];

        if (peer.peerId !== peerId) {
            addParticipant(peer, otherPeersElem);
        }
    }

    list.replaceChildren(heading, allPeersElem);
}

function updateParticipants() {

    createParticipantsList();

}

function sendFileChunks(message) {

    for(let i = 0; i < message.files.length; i++) {

        let chunkInfo = message.files[i];

        let file = filesMap.get(chunkInfo.clientFileId);
        if (file) {

            var posEnd = chunkInfo.chunkPosition + chunkInfo.chunkSize;
            if (posEnd > file.size) {
                posEnd = file.size;
            }

            let chunk = file.slice(chunkInfo.chunkPosition, posEnd);

            var reader = new FileReader();
            reader.readAsBinaryString(chunk);
            reader.onloadend = function () {

                let data = btoa(reader.result);
                let chunkSize = posEnd - chunkInfo.chunkPosition;
                socketSendNextData(JSON.stringify(
                    createFileChunkMessage(chunkInfo, data, chunkSize)));

                let sentLabel = document.getElementById("file_served_" + chunkInfo.serverFileId);
                let sent = parseInt(sentLabel.getAttribute("amount-sent")) + chunkSize;
                let spin = parseInt(sentLabel.getAttribute("progress-spin")) + 1;
                sentLabel.setAttribute("amount-sent", sent);
                sentLabel.setAttribute("progress-spin", spin);
                const progress = 'Sent: ' + humanFileSize(sent);
                sentLabel.textContent = progress;
                if (spin % 10 === 0) announceActivity('transfer', { progress });

            }

        }

    }

}

export function handleFiles(files) {

    let filesJson = [];

    for(let index = 0; index < files.length; index ++ ) {

        let file = files[index];
        let fileId = nextFileId();

        filesMap.set(fileId, file);

        filesJson.push({
            name: file.name,
            clientFileId: fileId,
            size: file.size
        });

    }

    let message = {code: CODE_FILE_SHARE, files: filesJson};
    socketSendNextData(JSON.stringify(message));

    document.getElementById('file_share_button').value = "";

}

// send message from the form
export function submitMessage() {
    const form = document.forms.publish;
    let outgoingMessage = form.message.value;

    let text = outgoingMessage.replace(/\s/g,''); // check if text not empty (remove all whitespaces)

    if(text !== "") {
        let message = {
            peerId: peerId,
            peerName: peerName,
            code: CODE_PEER_MESSAGE,
            message: outgoingMessage
        }
        socketSendNextData(JSON.stringify(message));
        form.message.value = "";
    }

    return false;
};

document.getElementById('chat_input').addEventListener('keydown', function (e) {
    if(e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        submitMessage();
        e.preventDefault();
    }
});

document.getElementById('chat_input').addEventListener("input", function () {

    let now = (new Date()).getTime();

    if(now > lastTimeTypingSent + 1000) {
        let message = {
            code: CODE_PEER_IS_TYPING,
        }
        socketSendNextData(JSON.stringify(message));
        lastTimeTypingSent = now;
    }

});

socket.onclose = function(event) {
    let status = document.getElementById('status_connection');
    status.textContent = "offline";
    status.className = "status_offline";
    announceActivity('connection', { message: 'Connection offline.' });
    peersMap.clear();
    updateParticipants();
};

// message received - show the message in div#messages
socket.onmessage = function(event) {
    protocolModule.then(function(protocol) {
        let message = protocol.parseProtocolMessage(event.data);
        if(message) {
            onMessage(message);
        }
    });
}

function onMessage(message) {

    switch(message.code) {

        case CODE_INFO:

            peerId = message.peerId;
            peerName = message.peerName;

            for (let index = 0; index < message.peers.length; index++) {
                let peer = message.peers[index];
                peersMap.set(peer.peerId, peer);
            }

            updateParticipants();

            if(message.history && message.history.length > 0) {
                hydratingHistory = true;
                for (let index = 0; index < message.history.length; index++) onMessage(message.history[index]);
                hydratingHistory = false;
            } else {
                onMessage({
                    code: CODE_PEER_JOINED,
                    peerId: peerId,
                    peerName: peerName,
                    message: peerName + " - joined room"
                });
            }

            break;

        case CODE_PEER_JOINED:
            postSystemMessage(message);
            let peer = new Object();
            peer.peerId = message.peerId;
            peer.peerName = message.peerName;
            peersMap.set(peer.peerId, peer);
            updateParticipants();
            announceActivity('joined', message);
            break;

        case CODE_PEER_LEFT:
            postSystemMessage(message);
            peersMap.delete(message.peerId);
            updateParticipants();
            announceActivity('left', message);
            break;

        case CODE_PEER_MESSAGE:
            postChatMessage(message);
            break;

        case CODE_PEER_IS_TYPING:
            postPeerIsTyping(message)
            break;

        case CODE_PEER_MESSAGE_FILE:
            postSharedFile(message);
            break;

        case CODE_FILE_REQUEST_CHUNK:
            sendFileChunks(message);
            break;

    }
}

function socketSendNextData(data) {
    socket.send(data);
}

window.addEventListener("beforeunload", function (e) {
    e.preventDefault();
    e.returnValue = "You are about to leave the chat. " +
        "Once you leave you'll lose chat history and all of your files shared will be canceled. " +
        "Are you sure you want to leave the chat?";
});
