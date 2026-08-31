# The digest is deliberate: a source revision always sees the same Alpine root.
FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc AS runtime

# Only runtime libraries are installed. Build tools and development headers
# must never reach this stage.
RUN apk add --no-cache ca-certificates libgcc libstdc++ libretls \
    && addgroup -S conspire \
    && adduser -S -D -H -G conspire conspire \
    && install -d -o conspire -g conspire -m 0755 /app /run/conspire

WORKDIR /app
ENV EXTERNAL_ADDRESS=localhost \
    EXTERNAL_PORT=8443 \
    TLS_FILE_PRIVATE_KEY=/run/certs/privkey.pem \
    TLS_FILE_CERT_CHAIN=/run/certs/fullchain.pem \
    URL_STATS_PATH=admin/stats.json

# Release automation supplies a verified binary and web assets from its build
# stage. Certificates are operator-mounted at /run/certs and are never copied.
COPY --chown=conspire:conspire conspire /app/conspire
COPY --chown=conspire:conspire front /app/front

USER conspire:conspire
VOLUME ["/run/conspire"]
EXPOSE 8443
ENTRYPOINT ["/app/conspire"]
