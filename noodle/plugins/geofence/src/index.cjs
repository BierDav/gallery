'use strict';
const {run} = require('./core.cjs');
// Deliberately avoid SDK wrapper debug logging: its config dump would include
// the API credential. The short-lived workflow token is NOT an HTTP API token.
function sortUpload() {
  const payload = JSON.parse(Host.inputString());
  const {apiUrl, apiKey} = payload.config;
  if (apiUrl !== 'https://photos.quickme.at/api' || !apiKey) throw new Error('Invalid API configuration');
  const host = Host.getFunctions();
  const api = (method, path, body) => {
    const args = [apiUrl + path, {method, headers: {'x-api-key': apiKey, 'Content-Type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})}];
    const input = Memory.fromString(JSON.stringify({authToken: payload.workflow.authToken, args}));
    let output;
    try {
      output = Memory.find(host.httpRequest(input.offset));
      const result = JSON.parse(output.readString());
      if (!result.success) throw new Error('Immich HTTP host function failed');
      const response = result.response;
      if (response.status < 200 || response.status >= 300) throw new Error('Immich API returned HTTP ' + response.status);
      return response.body ? JSON.parse(response.body) : null;
    } finally { if (output) output.free(); input.free(); }
  };
  Host.outputString(JSON.stringify(run(payload, api)));
}
module.exports = {sortUpload};
