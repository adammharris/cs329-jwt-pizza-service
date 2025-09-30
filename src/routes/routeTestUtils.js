const assert = require('assert');

function expectValidJwt(potentialJwt) {
  assert.match(potentialJwt, /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

module.exports = expectValidJwt;
