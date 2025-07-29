# Dockerfile by jaromil & pna

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
ENV EXTERNAL_ADDRESS="0.0.0.0"
ENV EXTERNAL_PORT=3000
ENV URL_STATS_PATH="admin/stats.json"
FROM alpine:latest
# Install only runtime dependencies needed
RUN apk add bash libstdc++ libgcc
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
EXPOSE 3000
CMD ["./canchat-exe"]
