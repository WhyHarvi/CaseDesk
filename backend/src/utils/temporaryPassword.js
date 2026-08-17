import { randomInt } from "node:crypto";

// Excludes visually ambiguous characters (0/O, 1/I/l) since this is read
// aloud over the phone and typed by hand as often as it's copy-pasted.
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALL = UPPER + LOWER + DIGITS;
const LENGTH = 10; // matches this app's own minimum password length

function pick(alphabet) {
  return alphabet[randomInt(alphabet.length)];
}

function shuffled(chars) {
  const array = [...chars];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [array[index], array[swap]] = [array[swap], array[index]];
  }
  return array;
}

// Guarantees at least one of each character class so the result can never
// accidentally read as all-digits (or otherwise look like a weak PIN).
export function generateTemporaryPassword() {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  const rest = Array.from({ length: LENGTH - required.length }, () => pick(ALL));
  return shuffled([...required, ...rest]).join("");
}
