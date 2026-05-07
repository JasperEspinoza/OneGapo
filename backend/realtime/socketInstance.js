let _io = null;

function set(io) {
  _io = io;
}

function get() {
  return _io;
}

module.exports = { set, get };
