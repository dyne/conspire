/**
 * Conspire Room Generator
 * 
 * Generates cryptographically random Base58 room IDs and redirects to Conspire.
 * 
 * Usage:
 *   1. Include this script in your landing page
 *   2. Add a button with id="new-room"
 *   3. Adjust CONSPIRE_PORT if needed
 */

const CONSPIRE_PORT = 8443;

/**
 * Encodes a Uint8Array into Base58.
 * Base58 alphabet excludes 0, O, I, l to avoid ambiguity.
 */
function encodeBase58(buffer) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    if (buffer.length === 0) return '';

    let digits = [0];
    for (let i = 0; i < buffer.length; i++) {
        for (let j = 0; j < digits.length; j++) digits[j] <<= 8;
        digits[0] += buffer[i];
        let carry = 0;
        for (let j = 0; j < digits.length; j++) {
            digits[j] += carry;
            carry = (digits[j] / 58) | 0;
            digits[j] %= 58;
        }
        while (carry) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }

    let str = '';
    for (let i = digits.length - 1; i >= 0; i--) str += ALPHABET[digits[i]];
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) str = '1' + str;
    return str;
}

/**
 * Generates a cryptographically random room ID.
 * Default 16 bytes produces ~22 Base58 characters.
 */
function generateRoomId(length = 16) {
    const buffer = new Uint8Array(length);
    crypto.getRandomValues(buffer);
    return encodeBase58(buffer);
}

/**
 * Redirects to a new Conspire room.
 */
function openNewRoom() {
    const roomId = generateRoomId();
    window.location.href = 'https://' + window.location.hostname + ':' + CONSPIRE_PORT + '/room/' + roomId;
}

// Auto-attach to button with id="new-room"
document.addEventListener('DOMContentLoaded', function() {
    const btn = document.getElementById('new-room');
    if (btn) btn.addEventListener('click', openNewRoom);
});
