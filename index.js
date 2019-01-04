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
const dbName='responsegeographic';

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
  const proxyURL = await Promise.resolve(req.url.replace('/drive511proxy/', ''));
  const response = await fetch(proxyURL);
  // const response = await fetch('http://api.open511.gov.bc.ca/events?format=json&status=ACTIVE');
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
    const db = client.db(dbName);
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
    const db = client.db(dbName);
    const collection = db.collection("sitemeta");
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

const getSiteLayers = async(req, res) => {
  const siteId = await Promise.resolve(req.params.siteId); 
  let client;
  let documents = [];
  try {
    // Use connect method to connect to the Server
    client = await MongoClient.connect(uri, { useNewUrlParser: true });
    const db = client.db(dbName);
    const collection = db.collection("layers");

    documents = await collection.find({'siteTags': siteId}).toArray();

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
}

const getSiteNavigation = async(req, res) => {
  const siteId = await Promise.resolve(req.params.siteId); 
  let client;
  let documents;
  try {
    // Use connect method to connect to the Server
    client = await MongoClient.connect(uri, { useNewUrlParser: true });
    const db = client.db(dbName);
    const collection = db.collection('navigation');

    documents = await collection.findOne({'siteId': siteId});

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
}

const getSiteLayersByIds = async(req, res) => {
  const siteIds = await Promise.resolve(req.params.siteIds); 
  let client;
  let documents = [];
  console.log(siteIds);
  try {
    // Use connect method to connect to the Server
    client = await MongoClient.connect(uri, { useNewUrlParser: true });
    const db = client.db(dbName);
    const collection = db.collection("layers");
    idsArray = siteIds.split(',');

    // Example { id: { $in: [ "bc-evacuation-alerts" , "bc-evacuation-orders", "bc-evacuation-all-clear" ] } }
    documents = await collection.find({ id: { $in: idsArray } }).toArray();

    console.log('documents', documents);
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
}

const ab511proxy = async (req, res) => {
  // const proxyURL = await Promise.resolve(req.params.url);
  const proxyURL = await Promise.resolve(req.url.replace('/ab511proxy/', ''));
  const request = await fetch(proxyURL);
  const data = await request.text();
  var json = JSON.parse(data);

  json = ab511toGeoJson(json);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // // res.setHeader('Content-Type', 'text/xml');
  send(res, 200, JSON.stringify(json));
}

// getDriveBCCameras
const getDriveBCCameras = async (req, res) => {
  const proxyURL = await Promise.resolve(req.url.replace('/getDriveBCCameras/', ''));
  const request = await fetch(proxyURL);
  const data = await request.text();
  var json = JSON.parse(data);

  json = bcCameraJsontoGeoJson(json);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // // res.setHeader('Content-Type', 'text/xml');
  send(res, 200, JSON.stringify(json));
}

function bcCameraJsontoGeoJson(json){
  var geoJson = {
    "type": "FeatureCollection",
    "features": [],
  };
  for (var i = 0; i < json.length; i++) {
    var item = json[i];
    var feature = {
      "type": "Feature",
    };
    feature.geometry = {
      "type": "Point",
      "coordinates": [item[6], item[5]],
    };
    feature.properties = {};
    feature.properties.id = item[0];
    feature.properties.name = item[1];
    feature.properties.description = item[2];
    feature.properties.source = item[3];
    feature.properties.direction = item[4];
    feature.properties.image = `http://images.drivebc.ca/bchighwaycam/pub/cameras/${item[0]}.jpg`;
    feature.properties.link = `http://images.drivebc.ca/bchighwaycam/pub/html/dbc/${item[0]}.html`;
    geoJson.features.push(feature);
  }
  return geoJson;
}

function ab511toGeoJson(json){
  var geoJson = {
          "type": "FeatureCollection",
          "features": [],
      };
  // restructure DriveBC 511 API JSON to become geoJSON compliant
  for (var i = 0; i < json.length; i++) {
      var item = json[i];

      if(item.Status === 'Enabled') {
        var feature = {
          "type": "Feature",
        };

        feature.geometry = {
          "type": "Point",
          "coordinates": [item.Longitude, item.Latitude],
        };

        delete item.Longitude;
        delete item.Latitude;

        feature.properties = {};
        feature.properties['Url'] = encodeURI(item.Url),
        delete item.Url;

        Object.keys(item).forEach(function(key) {
          feature.properties[key] = item[key];
        });

        geoJson.features.push(feature);
      }
  };
  return geoJson;
}

const avalancheCanada = async (req, res) => {
  const proxyURL = 'https://www.avalanche.ca/api/forecasts';
  const request = await fetch(proxyURL);
  const data = await request.text();
  var json = JSON.parse(data);

  let features = json.features;

  for (const feature of features) {
    // add layer id
    let forecasteUrl = '';

    if (feature.properties.forecastUrl) {
      forecastUrl =  'https://www.avalanche.ca' + feature.properties.forecastUrl;
      const forecastDescription = await avalancheCanadaForecast(forecastUrl);
      
      if (forecastDescription){
        Object.keys(forecastDescription).forEach(function(key) {
          feature.properties[key] = forecastDescription[key];
        });

        feature.properties.start_date = forecastDescription.dangerRatings[0].date;
        const currentDangerRatings = forecastDescription.dangerRatings[0].dangerRating;
        
        Object.keys(currentDangerRatings).forEach(function(key) {
          feature.properties[key] = currentDangerRatings[key];
        });

      }
    } // else {
      // create forecast url later
      // console.log(' no forecast url', feature.properties.id);
    // }
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // // res.setHeader('Content-Type', 'text/xml');
  send(res, 200, JSON.stringify(json));
};

const avalancheCanadaForecast = async (forecastUrl, req, res) => {
  const request = await fetch(forecastUrl);
  const data = await request.text();

  let json = {};
  if(data) {
    try {
        json = JSON.parse(data);
    } catch(e) {
        json = null;
    }
  }
  return json;
};

const getAllLayers = async(req, res) => {
  let client;
  // let documents = [];
  try {
    // Use connect method to connect to the Server
    client = await MongoClient.connect(uri, { useNewUrlParser: true });
    const db = client.db(dbName);
    const collection = db.collection("navigation");
    // let documents = await collection.findOne({'siteId': siteId});

    let documents = await collection.aggregate(
      [
        {
          '$unwind': {
            'path': '$navigationDefinitions'
          }
        }, {
          '$group': {
            '_id': 0, 
            'id': {
              '$push': '$navigationDefinitions.id'
            }
          }
        }, {
          '$lookup': {
            'from': 'layers', 
            'localField': 'id', 
            'foreignField': 'id', 
            'as': 'navigationDefinitions'
          }
        }, {
          '$project': {
            'navigationDefinitions': 1, 
            '_id': 0
          }
        }
      ]).toArray();

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

const getLayersByNavigation = async(req, res) => {
  const siteId = await Promise.resolve(req.params.siteId); 
  let client;
  let documents = [];
  try {
    // Use connect method to connect to the Server
    client = await MongoClient.connect(uri, { useNewUrlParser: true });
    const db = client.db(dbName);
    const collection = db.collection("navigation");
    // let documents = await collection.findOne({'siteId': siteId});

    documents = await collection.aggregate(
      [
        {
          '$match': {
            'siteId': siteId
          }
        }, {
          '$unwind': {
            'path': '$navigationDefinitions'
          }
        }, {
          '$group': {
            '_id': 0, 
            'id': {
              '$push': '$navigationDefinitions.id'
            }
          }
        }, {
          '$lookup': {
            'from': 'layers', 
            'localField': 'id', 
            'foreignField': 'id', 
            'as': 'navigationDefinitions'
          }
        }, {
          '$project': {
            'navigationDefinitions': 1, 
            '_id': 0
          }
        }
      ]).toArray();

    // returns null if there are no documents
    res.setHeader('Access-Control-Allow-Origin', '*');
    send(res, 200, documents[0].navigationDefinitions);

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
  get('/ab511proxy/:url', ab511proxy),
  get('/smokeproxy', smokeproxy),
  get('/kmltogeojson/:url', kmltogeojson),
  get('/simplifygeojson/:url', simplifygeojson),
  get('/drive511proxy/:url', drive511proxy),
  get('/getDriveBCCameras/:url', getDriveBCCameras),
  get('/avalancheCanada', avalancheCanada),
  get('/aggregateLayers/:groupId', aggregateLayers),
  get('/getSiteMeta/:siteId', getSiteMeta),
  get('/getSiteLayers/:siteId', getSiteLayers),
  get('/getSiteLayersByIds/:siteIds', getSiteLayersByIds),
  get('/getSiteNavigation/:siteId', getSiteNavigation),
  get('/getAllLayers', getAllLayers),
  get('/getLayersByNavigation/:siteId', getLayersByNavigation),
  get('/*', notfound)
);