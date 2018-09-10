const { send } = require('micro');
const { router, get } = require('microrouter');
const fetch = require('node-fetch');
const tj = require('@mapbox/togeojson');
const DOMParser = require('xmldom').DOMParser;
const flatten = require('geojson-flatten');
var simplify = require('simplify-geojson')



// map severity levels of events to a color
const severityColors = {
  "MINOR": "#ffff00",
  "MODERATE": "#f5a623",
  "MAJOR": "#ff0000",
};


const smokeproxy = async (req, res) => {
  const response = await fetch('https://www.ospo.noaa.gov/data/land/fire/smoke.kml');
  const data = await response.text();

  // return data

  res.setHeader('Access-Control-Allow-Origin', '*');
  // res.setHeader('Content-Type', 'text/xml');
  send(res, 200, data);
}

const kmltogeojson = async (req, res) => {

  const proxyURL = await Promise.resolve(req.params.url);
  const response = await fetch(proxyURL);
  const kml = await response.text();
  const kmlDom = new DOMParser().parseFromString(kml);

  const converted = tj.kml(kmlDom, { styles: false });

  res.setHeader('Access-Control-Allow-Origin', '*');
  send(res, 200, converted);
}


const proxy = async (req, res) => {
  // const proxyURL = await Promise.resolve(req.params.url);
  const proxyURL = await Promise.resolve(req.url.replace('/proxy/', ''));
  const request = await fetch(proxyURL);
  const data = await request.text();

  res.setHeader('Access-Control-Allow-Origin', '*');
  send(res, 200, data);
}

const notfound = (req, res) => send(res, 404, 'Not found route');

const drive511proxy = async (req, res) => {
  const response = await fetch('http://api.open511.gov.bc.ca/events?format=json&status=ACTIVE&event_type=INCIDENT');
  const data = await response.text();
  var json = JSON.parse(data);
  json = json.events; 
  // // restructure DriveBC 511 API JSON to become geoJSON compliant
  json = driveBCtoGeoJson(json);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // // res.setHeader('Content-Type', 'text/xml');
  send(res, 200, JSON.stringify(json));
}

function driveBCtoGeoJson(json){
  var geoJson = {
          "type": "FeatureCollection",
          "features": [],
      };
  // restructure DriveBC 511 API JSON to become geoJSON compliant
  for (var i = 0; i < json.length; i++) {
      var event = json[i];

      var feature = {
          "type": "Feature"
      };
      feature.properties = event;
      feature.geometry = event.geography;
      delete event.geography;

      // add color properties to the feature JSON
      // Note that tokml's handling of styles is a bit busted, but this will generate the needed ids
      feature.properties["marker-color"] = severityColors[event.severity];
      feature.properties["stroke"] = severityColors[event.severity];
      feature.properties['title'] = event.severity + ' ' + event.headline + ': ' + event.roads[0].name;

      geoJson.features.push(feature);
  };
  return geoJson;
}

const simplifygeojson = async (req, res) => {

  const proxyURL = await Promise.resolve(req.url.replace('/simplifygeojson/', ''));
  const response = await fetch(proxyURL);
  // const geojson = await response.text();

  const data = await response.text();
  var geojson = JSON.parse(data);

  // var simplified = flatten(geojson);
  var simplified = simplify(geojson, (req.query.tolerance || 1));

  res.setHeader('Access-Control-Allow-Origin', '*');
  send(res, 200, simplified);
}
 
module.exports = router(
  get('/proxy/:url', proxy),
  get('/smokeproxy', smokeproxy),
  get('/kmltogeojson/:url', kmltogeojson),
  get('/simplifygeojson/:url', simplifygeojson),
  get('/drive511proxy', drive511proxy),
  get('/*', notfound)
);