'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { register } = require('node:module');

const registerDir = __dirname;

register(
  pathToFileURL(path.join(registerDir, 'gateway-esm-loader.mjs')),
  pathToFileURL(__filename),
);
