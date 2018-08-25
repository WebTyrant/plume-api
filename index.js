const { send } = require('micro');
const { router, get } = require('microrouter');
const fetch = require('node-fetch');
const tj = require('@mapbox/togeojson');
const DOMParser = require('xmldom').DOMParser;

const smokeproxy = async (req, res) => {
  const response = await fetch('https://www.ospo.noaa.gov/data/land/fire/smoke.kml');
  const data = await response.text();

  // return data

  res.setHeader('Access-Control-Allow-Origin', '*');
  // res.setHeader('Content-Type', 'text/xml');
  send(res, 200, data);
}

const kmltogeojson = async (req, res) => {

  const proxyURL = await Promise.resolve(`${req.params.url}`);
  console.log(req.params.url);
  const response = await fetch(proxyURL);
  const kml = await response.text();
  const kmlDom = new DOMParser().parseFromString(kml);

  const converted = tj.kml(kmlDom, { styles: false });

  res.setHeader('Access-Control-Allow-Origin', '*');
  send(res, 200, converted);
}


const proxy = async (req, res) => {
  const proxyURL = await Promise.resolve(`${req.params.url}`);
  console.log(req.params.url);
  const request = await fetch(proxyURL);
  const data = await request.text();

  res.setHeader('Access-Control-Allow-Origin', '*');
  send(res, 200, data);
}

const notfound = (req, res) => send(res, 404, 'Not found route');
 
module.exports = router(
  get('/proxy/:url', proxy),
  get('/smokeproxy', smokeproxy),
  get('/kmltogeojson/:url', kmltogeojson),
  get('/*', notfound)
);