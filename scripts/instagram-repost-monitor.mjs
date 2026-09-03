/**
 * SportsWire247's RapWire-compatible monitor entry point.
 *
 * The implementation stays local: it uses only the dedicated SportsWire247
 * Chrome profile and the isolated runtime/ directory.  It intentionally does
 * not import, read, or write any RapWire queue, account, media, or state.
 */
import "../src/worker.mjs";
