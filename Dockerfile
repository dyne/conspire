# Dockerfile by jaromil

FROM alpine:latest AS builder
RUN apk add bash clang cmake make samurai git musl-dev libressl-dev pkgconfig ccache
WORKDIR /app
COPY . .

RUN make \
    build/oatpp.orig \
    build/oatpp-websocket.orig \
    build/oatpp-openssl.orig

RUN cd build/oatpp.orig \
    &&    cmake -G Ninja -S . -B build \
    -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
    &&    ninja -C build install
RUN cd build/oatpp-websocket.orig \
    &&    cmake -G Ninja -S . -B build \
    -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
    &&    ninja -C build install
RUN cd build/oatpp-openssl.orig \
    &&    cmake -G Ninja -S . -B build \
    -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
    &&    ninja -C build install

RUN cmake -G Ninja -S server -B build \
    -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
    &&    ninja -C build \
    &&    cp build/canchat-exe conspire \
    &&    strip conspire


# Runtime stage
FROM alpine:latest AS runtime
ARG HOSTNAME="localhost"
ENV EXTERNAL_ADDRESS=${HOSTNAME}
ARG PORT=8443
ENV EXTERNAL_PORT=${PORT}
ENV TLS_FILE_PRIVATE_KEY="/app/cert/privkey.pem"
ENV TLS_FILE_CERT_CHAIN="/app/cert/fullchain.pem"
ENV URL_STATS_PATH="admin/stats.json"
FROM alpine:latest
# Install only runtime dependencies needed
RUN apk add libressl-dev libressl ca-certificates libstdc++ libgcc
# Create a non-root user and group (e.g., "appuser")
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# Optional: Set workdir and ownership
WORKDIR /app
RUN chown appuser:appgroup /app
# Switch to the non-root user
USER appuser
# Copy the built binary from the builder stage
COPY --from=builder /app/conspire .
# Copy frontend files
COPY --from=builder /app/front front
# Generate self-signed certificates
RUN mkdir -p cert
RUN libressl req -x509 -nodes -days 365 -newkey rsa:2046 \
    -keyout cert/privkey.pem \
    -out cert/test_cert.crt \
    -subj "/C=NL/ST=Netherlands/L=Amsterdam/O=Dyne.org/CN=dyne.org" \
    && cat cert/test_cert.crt cert/privkey.pem > cert/fullchain.pem
CMD ["./conspire"]
