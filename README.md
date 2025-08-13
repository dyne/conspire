<div align="center">

```

░█▀▀░█▀█░█▀█░█▀▀░█▀█░▀█▀░█▀▄░█▀▀░░░░█▀▄░█░█░█▀█░█▀▀░░░░█▀█░█▀▄░█▀▀  
░█░░░█░█░█░█░▀▀█░█▀▀░░█░░█▀▄░█▀▀░░░░█░█░░█░░█░█░█▀▀░░░░█░█░█▀▄░█░█  
░▀▀▀░▀▀▀░▀░▀░▀▀▀░▀░░░▀▀▀░▀░▀░▀▀▀░▀░░▀▀░░░▀░░▀░▀░▀▀▀░▀░░▀▀▀░▀░▀░▀▀▀  
ephemeral • p2p • anonymous • synchronous
```

**Conspire** is a web-based sanctuary for radical exchange: ephemeral,
anonymous, and synchronous.

</div>

Jump into instant rooms where voices and files move
peer-to-peer, leaving no footprints. Built by dyne.org to empower digital
autonomy, it's freedom in the form of conversation.

<div align="center">

![BConspira](https://secrets.dyne.org/static/img/secret_ladies.jpg)
</div>

---
## 🚀 Quick Start

Go to [conspire.dyne.org](https://conspire.dyne.org) and bring your friends.

Run locally on docker (demo only!):
```
docker run -p8443:8443 ghcr.io/dyne/conspire:latest
```
This is just for demonstration with invalid TLS certs: conspire doesn't runs inside a container as it needs websockets forwarding and has CORS safety controls in place, therefore it needs to be directly connected to the Internet with a port dedicated to it.

---
## 🛠️ How It Works (assuming your browser hasn't betrayed you yet)

Conspire is built on the principle that chatrooms should be as fleeting and
commitment-free as your average internet hot take. You join with a URL, which
is randomly generated, because nothing says “security” like hoping no one else
guesses your 40-character alphanumeric spaghetti.

Anyone with the room’s URL can join. This includes your friends, colleagues,
and possibly your neighbor’s cat if it learns to copy-paste. Share wisely.

Rooms self-assemble the moment someone enters, like magic.  They vanish when
the last person leaves: no ghosts, no receipts, no archive. If you’re feeling
abandoned, the room probably feels the same way.

Chat history politely exists for newcomers, until a configurable number of
messages accumulate, at which point it gets “rounded,” i.e., possibly
lobotomized. Once the room dies, the history follows: no funeral, no backup.

### 📁 File Sharing (the not-so-cloud way)


You can share multiple files, streamed straight from your device like it’s 2002
and BitTorrent had a soul. No uploads to shadowy servers. No mysterious third
parties. Just you, your files, and the terrifying fragility of your internet
connection.

Once the host peer hits cancel or rage-quits the room, all their shared files
evaporate. If they exit entirely, it’s like they were never generous at all.

### ❓ FAQ (Frequently Avoided Questions)

<details>
<summary><strong>Can anyone join my chatroom?</strong></summary>

Anyone with the URL can waltz right in. Yes, even your former coworker who
still thinks faxing PDFs is peak productivity. Share wisely: or don’t, and enjoy
the chaos.
</details>

<details>
<summary><strong>Is the room permanent?</strong></summary>

About as permanent as your browser’s cache after you hit "clear." Rooms
appear when someone joins and vanish when everyone leaves. It’s digital
nihilism in action.
</details>

<details>
<summary><strong>Can I save my chat history?</strong></summary>

Technically, yes: if you read really fast and use screenshots like it’s 1999.
Otherwise, history is retained only until the room exceeds a certain number of
messages. Then it’s gently euthanized by config.
</details>

<details>
<summary><strong>Where are the files stored?</strong></summary>

On the host’s machine, like nature intended. No cloud, no creepy data
hoarding. When the host bails or hits cancel, the files evaporate like polite
intentions in a comment thread.
</details>

<details>
<summary><strong>Can I upload cat memes?</strong></summary>

You can stream _multiple_ cat memes directly from your machine. But once you
exit the room, the dream dies: and so do the memes.
</details>

<details>
<summary><strong>Is this service free?</strong></summary>

Yes. But it may cost you your last shred of trust in centralized platforms.
</details>

<details>
<summary><strong>Is Conspire secure?</strong></summary>

Anonymous, ephemeral, peer-to-peer? It’s like privacy grew up and started
smoking clove cigarettes. That’s a yes.
</details>

---
## 💼 License

Conspire is based on [can-chat](https://github.com/lganzzzo/canchat) by Leonid
Stryzhevskyi, it is written in C++ and built with [Oat++ Web Framework](https://oatpp.io/).

This project is released under [Apache License 2.0](LICENSE).
