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
ENV TLS_FILE_PRIVATE_KEY="/app/cert/privkey.pem"
ENV TLS_FILE_CERT_CHAIN="/app/cert/fullchain.pem"
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
RUN libressl req -x509 -nodes -days 365 -newkey rsa:2046 \
    -keyout cert/privkey.pem \
    -out cert/test_cert.crt \
    -subj "/C=IT/ST=Italy/L=Rome/O=Dyne.org/CN=dyne.org" && \
    cat cert/test_cert.crt cert/privkey.pem > cert/fullchain.pem
CMD ["./canchat-exe"]
