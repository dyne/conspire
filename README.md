<div align="center">

![Conspire logotype](https://dyne.org/images/logos/conspire_text_black.svg)

**Conspire** is a web-based chat for radical exchange: peer to peer,
ephemeral, anonymous, and synchronous.

</div>

Jump into instant rooms where voices and files move
peer-to-peer, leaving no footprints. Conspire is built for privacy and digital
autonomy.

## 🚀 Quick Start

Go to [conspire.dyne.org](https://dyne.org/conspire) and bring your friends.

Run locally on docker (self-signed certs, demo only!):

```
docker run -p8443:8443 ghcr.io/dyne/conspire:latest
```

Please know conspire needs reachable websockets and has CORS safety controls in place, therefore it needs to be directly connected to the network with a port dedicated to it. Running it inside a container is not supported.


## 💼 License

Conspire is based on [can-chat](https://github.com/lganzzzo/canchat) by Leonid
Stryzhevskyi, it is written in C++ and built with [Oat++ Web Framework](https://oatpp.io/).

This project is released under [Apache License 2.0](LICENSE).
