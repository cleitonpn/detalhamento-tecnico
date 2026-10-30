import { relationsFromPayload } from "./payload.js";
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: relationsFromPayload(data, testedPairs => self.postMessage({ progress: { testedPairs } })) }); }
  catch (e) { self.postMessage({ error: e.message }); }
};
