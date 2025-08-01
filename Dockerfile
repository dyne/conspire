# Dockerfile by jaromil

FROM alpine:latest AS builder
RUN apk add bash clang cmake make git pkgconfig
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
ARG HOSTNAME="localhost"
ENV EXTERNAL_ADDRESS=${HOSTNAME}
ARG PORT=8443
ENV EXTERNAL_PORT=${PORT}
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
CMD ["./canchat-exe"]
