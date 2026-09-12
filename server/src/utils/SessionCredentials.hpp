#ifndef ASYNC_SERVER_UTILS_SESSION_CREDENTIALS_HPP
#define ASYNC_SERVER_UTILS_SESSION_CREDENTIALS_HPP

#include "utils/SessionReliability.hpp"

#include <array>
#include <openssl/crypto.h>
#include <openssl/rand.h>
#include <openssl/sha.h>
#include <string>

namespace conspire::session {

using TokenDigest = std::array<unsigned char, SHA256_DIGEST_LENGTH>;

inline std::string base64Url(const unsigned char* data, std::size_t size) {
  static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  std::string result;
  result.reserve((size * 4U + 2U) / 3U);
  for (std::size_t i = 0; i < size; i += 3) {
    const unsigned int first = data[i];
    const unsigned int second = i + 1 < size ? data[i + 1] : 0U;
    const unsigned int third = i + 2 < size ? data[i + 2] : 0U;
    result.push_back(alphabet[first >> 2U]);
    result.push_back(alphabet[((first & 0x03U) << 4U) | (second >> 4U)]);
    if (i + 1 < size) result.push_back(alphabet[((second & 0x0fU) << 2U) | (third >> 6U)]);
    if (i + 2 < size) result.push_back(alphabet[third & 0x3fU]);
  }
  return result;
}

inline bool makeResumeToken(std::string& token) {
  std::array<unsigned char, 32> bytes{};
  if (RAND_bytes(bytes.data(), static_cast<int>(bytes.size())) != 1) return false;
  token = base64Url(bytes.data(), bytes.size());
  return validBase64UrlId(token, bytes.size());
}

inline TokenDigest digestToken(const std::string& token) {
  TokenDigest digest{};
  SHA256(reinterpret_cast<const unsigned char*>(token.data()), token.size(), digest.data());
  return digest;
}

inline bool constantTimeDigestEqual(const TokenDigest& left, const TokenDigest& right) {
  return CRYPTO_memcmp(left.data(), right.data(), left.size()) == 0;
}

} // namespace conspire::session

#endif
