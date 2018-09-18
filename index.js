const { send } = require('micro');
const { router, get } = require('microrouter');
const fetch = require('node-fetch');
const tj = require('@mapbox/togeojson');
const esriToGeoJSON = require('esri-to-geojson')
const DOMParser = require('xmldom').DOMParser;
const flatten = require('geojson-flatten');
const simplify = require('simplify-geojson');
const moment = require('moment');

const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');

const PASSWORD = encodeURI('AC1190!');
const uri = `mongodb+srv://AdventureConditions:${PASSWORD}@adventureconditionscluster0-7honr.mongodb.net/test?retryWrites=true`;

// map severity levels of events to a color
const severityColors = {
  "MINOR": "#ffff00",
  "MODERATE": "#f5a623",
  "MAJOR": "#ff0000",
};


const smokeproxy = async (req, res) => {
  const response = await fetch('https://www.ospo.noaa.gov/data/land/fire/smoke.kml');
  const data = await response.text();
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

const findDocuments = function(collection, findJson, callback) {
  collection.find(findJson).toArray(function(err, docs) {
    assert.equal(err, null);
    callback(docs);
  });
}

const fetchAggregationLayers = async(groupId) => {
  // console.log('fetchAggregationLayers: ', groupId);
  let client;
  let documents = [];
  try {
    // Use connect method to connect to the Server
    client = await MongoClient.connect(uri, { useNewUrlParser: true });
    const db = client.db("adventureConditions");
    const collection = db.collection("aggregationSources");

    documents = await collection.find({'groupId': groupId}).toArray();

  } catch (err) {
    console.log(err.stack);
  }

  if (client) {
    client.close();
  }
  return documents;
}

// Update aggregationTime


const aggregateLayers = async (req, res) => {
  const groupId = await Promise.resolve(req.params.groupId);
  const layers = await Promise.resolve(fetchAggregationLayers(groupId));
  const aggregationTime = moment();

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const response = await Promise.resolve(fetch(layer.endpoint));
      let data = await Promise.resolve(response.json());

      if(layer.type ==='esrijson'){
        data = esriToGeoJSON.fromEsri(data)
      }

      const features = data.features;
      const fields = layer.fields;

      features.forEach((feature, index) => {
        // add layer id
        feature.properties.layerId = layer.layerId;

        // normalize field names
        for (var fieldKey in fields) {
          var fieldValue = feature.properties[fields[fieldKey]];
          if (fieldValue === undefined) fieldValue = fields[fieldKey];
          feature.properties[fieldKey] = fieldValue;
          delete feature.properties[fields[fieldKey]];
        }
      });

      console.log(features);


    }

  res.setHeader('Access-Control-Allow-Origin', '*');
  send(res, 200, 'aggregateLayers Success: ' + groupId);
}

const getSiteMeta = async(req, res) => {
  const siteId = await Promise.resolve(req.params.siteId); 
  let client;
  // let documents = [];
  try {
    // Use connect method to connect to the Server
    client = await MongoClient.connect(uri, { useNewUrlParser: true });
    const db = client.db("adventureConditions");
    const collection = db.collection("siteMeta");
    let documents = await collection.findOne({'siteId': siteId});

    // returns null if there are no documents
    res.setHeader('Access-Control-Allow-Origin', '*');
    send(res, 200, documents);

  } catch (err) {
    send(res, 500, 'Error: ' + err);
    console.log(err.stack);
  }

  if (client) {
    client.close();
  }
  //return documents;
}

const notfound = (req, res) => send(res, 404, 'Not found route');

module.exports = router(
  get('/proxy/:url', proxy),
  get('/smokeproxy', smokeproxy),
  get('/kmltogeojson/:url', kmltogeojson),
  get('/simplifygeojson/:url', simplifygeojson),
  get('/drive511proxy', drive511proxy),
  get('/aggregateLayers/:groupId', aggregateLayers),
  get('/getSiteMeta/:siteId', getSiteMeta),
  get('/*', notfound)
);