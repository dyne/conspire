<div align="center">

```

░█▀▀░█▀█░█▀█░█▀▀░█▀█░▀█▀░█▀▄░█▀▀░░░░█▀▄░█░█░█▀█░█▀▀░░░░█▀█░█▀▄░█▀▀  
░█░░░█░█░█░█░▀▀█░█▀▀░░█░░█▀▄░█▀▀░░░░█░█░░█░░█░█░█▀▀░░░░█░█░█▀▄░█░█  
░▀▀▀░▀▀▀░▀░▀░▀▀▀░▀░░░▀▀▀░▀░▀░▀▀▀░▀░░▀▀░░░▀░░▀░▀░▀▀▀░▀░░▀▀▀░▀░▀░▀▀▀  
ephemeral • p2p • anonymous • synchronous
```

**Conspire** is a web-based chat for radical exchange: ephemeral,
anonymous, and synchronous.

</div>

Jump into instant rooms where voices and files move
peer-to-peer, leaving no footprints. Conspire is built for privacy and digital
autonomy.

<div align="center">

![BConspira](https://secrets.dyne.org/static/img/secret_ladies.jpg)
</div>

---

## 🚀 Quick Start

Go to [conspire.dyne.org](https://dyne.org/conspire) and bring your friends.

Run locally on docker (demo only!):

```
docker run -p8443:8443 ghcr.io/dyne/conspire:latest
```

This is just for demonstration with invalid TLS certs: conspire doesn't runs inside a container as it needs websockets forwarding and has CORS safety controls in place, therefore it needs to be directly connected to the Internet with a port dedicated to it.

---

## 🛠️ How It Works (assuming your browser hasn't betrayed you yet)

Conspire is built on the principle that chatrooms should be as fleeting and
commitment-free.

Anyone with the room’s URL can join: no login, not even a nickname is asked.

Rooms self-assemble the moment someone enters. They vanish when
the last person leaves: no ghosts, no receipts, no archive.

Chat history politely exists for newcomers up to 100 messages. Once the room dies, the history follows: no backup.

### 📁 File Sharing

One can share multiple files: when shared they are streamed straight from and to each other device. No uploads on our server. No third
party in between.

If somoene leaves, shared files aren't available anymore.

---

## 💼 License

Conspire is based on [can-chat](https://github.com/lganzzzo/canchat) by Leonid
Stryzhevskyi, it is written in C++ and built with [Oat++ Web Framework](https://oatpp.io/).

This project is released under [Apache License 2.0](LICENSE).
