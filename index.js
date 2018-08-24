const { send } = require('micro');
const { router, get } = require('microrouter');
const fetch = require('node-fetch');
// const request = require("request");

const hello = async (req, res) =>
  send(res, 200, await Promise.resolve(`Hello ${req.params.who}`));

const proxy = async (req, res) =>
  send(res, 200, await Promise.resolve(`Proxy ${req.params.url}`));

const notfound = (req, res) => send(res, 404, 'Not found route');
 
module.exports = router(
  get('/hello/:who', hello),
  get('/proxy/:url', proxy),
  get('/*', notfound)
);