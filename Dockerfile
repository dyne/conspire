# Dockerfile by jaromil

FROM alpine:latest AS builder
RUN apk add bash clang cmake make git libressl-dev pkgconfig
WORKDIR /chat
ADD utility utility
WORKDIR /chat/utility
RUN /bin/bash ./install-oatpp-modules.sh Release
WORKDIR /chat
ADD front front
ADD server server
WORKDIR /chat/server/build
RUN cmake -DCMAKE_BUILD_TYPE=Release ..
RUN make -j `nproc`

# Runtime stage
FROM alpine:latest AS runtime
ENV EXTERNAL_ADDRESS="localhost"
ENV EXTERNAL_PORT=8443
ENV TLS_FILE_PRIVATE_KEY="/app/cert/test_key.pem"
ENV TLS_FILE_CERT_CHAIN="/app/cert/test_cert.crt"
ENV URL_STATS_PATH="admin/stats.json"
FROM alpine:latest
# Install only runtime dependencies needed
RUN apk add libressl-dev libressl ca-certificates bash libstdc++ libgcc
# Create a non-root user and group (e.g., "appuser")
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# Optional: Set workdir and ownership
WORKDIR /app
RUN chown appuser:appgroup /app
# Switch to the non-root user
USER appuser
# Copy the built binary from the builder stage
COPY --from=builder /chat/server/build/canchat-exe .
# Copy frontend files
COPY --from=builder /chat/front front
# Generate self-signed certificates
RUN mkdir -p cert
RUN libressl req -x509 -nodes -days 365 -newkey rsa:4096 \
    -keyout cert/private.key \
    -out cert/test_cert.crt \
    -subj "/C=IT/ST=Italy/L=Rome/O=Dyne.org/CN=dyne.org" && \
    cat cert/test_cert.crt cert/private.key \
    > cert/test_key.pem && \
    chmod 644 cert/test_cert.crt && \
    chmod 600 cert/private.key && \
    chmod 644 cert/test_key.pem

CMD ["./canchat-exe"]
