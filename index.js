const express = require("express");
const compression = require("compression");
const moment = require("moment");
const fetch = require("node-fetch");
const fs = require("fs");
const cors = require("cors");
const { exec } = require("child_process");

const app = express();
const grib2json = process.env.GRIB2JSON || "./converter/bin/grib2json";
const port = process.env.PORT || 7000;
const resolution = process.env.RESOLUTION || "0.5";
const wind = process.env.WIND || true;
const temp = process.env.TEMP || false;
const baseDir = `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_${resolution === "1" ? "1p00" : "0p50"}.pl`;

// cors config
const whitelist = [
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:4000",
];

const corsOptions = {
  origin(origin, callback) {
    const originIsWhitelisted = whitelist.indexOf(origin) !== -1;
    callback(null, originIsWhitelisted);
  },
};

app.use(compression());
app.listen(port, () => {
  console.log(`Running wind server for data resolution of ${resolution === "1" ? "1" : "0.5"} degree on port ${port}`);
});

app.get("/", cors(corsOptions), (req, res) => {
  res.send("Wind server : go to /latest for last wind data.");
});

app.get("/alive", cors(corsOptions), (req, res) => {
  res.send("Wind server is alive");
});

app.get("/latest", cors(corsOptions), (req, res) => {
  /**
   * Find and return the latest available 6 hourly pre-parsed JSON data
   *
   * @param targetMoment {Object} UTC moment
   */
  function sendLatest(targetMoment) {
    const stamp = moment(targetMoment).format("YYYYMMDD") + roundHours(moment(targetMoment).hour(), 6);
    const fileName = `${__dirname}/json-data/${stamp}.json`;

    res.setHeader("Content-Type", "application/json");
    res.sendFile(fileName, {}, (err) => {
      if (err) {
        console.log(`${stamp} doesnt exist yet, trying previous interval`);
        sendLatest(moment(targetMoment).subtract(6, "hours"));
      }
    });
  }

  sendLatest(moment().utc());
});

app.get("/nearest", cors(corsOptions), (req, res, next) => {
  const time = req.query.timeIso;
  const limit = req.query.searchLimit;
  let searchForwards = false;

  /**
   * Find and return the nearest available 6 hourly pre-parsed JSON data
   * If limit provided, searches backwards to limit, then forwards to limit before failing.
   *
   * @param targetMoment {Object} UTC moment
   */
  function sendNearestTo(targetMoment) {
    if (limit && Math.abs(moment.utc(time).diff(targetMoment, "days")) >= limit) {
      if (!searchForwards) {
        searchForwards = true;
        sendNearestTo(moment(targetMoment).add(limit, "days"));
        return;
      }
      next(new Error("No data within searchLimit"));
      return;
    }

    const stamp = moment(targetMoment).format("YYYYMMDD") + roundHours(moment(targetMoment).hour(), 6);
    const fileName = `${__dirname}/json-data/${stamp}.json`;

    res.setHeader("Content-Type", "application/json");
    res.sendFile(fileName, {}, (err) => {
      if (err) {
        const nextTarget = searchForwards ? moment(targetMoment).add(6, "hours") : moment(targetMoment).subtract(6, "hours");
        sendNearestTo(nextTarget);
      }
    });
  }

  if (time && moment(time).isValid()) {
    sendNearestTo(moment.utc(time));
  } else {
    next(new Error("Invalid params, expecting: timeIso=ISO_TIME_STRING"));
  }
});

function nextFile(targetMoment, offset, success) {
  const previousTargetMoment = moment(targetMoment).subtract(6, "hours");

  if (moment.utc().diff(previousTargetMoment, "days") > 10) {
    console.log("Harvest complete or there is a big gap in data");
    return;
  }
  if (!success || offset > 12) {
    // Download previous targetMoment
    getGribData(previousTargetMoment, 0);
  } else {
    // Download forecast of current targetMoment
    getGribData(targetMoment, offset + 3);
 }
}

/**
 *
 * Finds and downloads the latest 6 hourly GRIB2 data from NOAA
 *
 */
function getGribData(targetMoment, offset) {
  const date = moment(targetMoment).format("YYYYMMDD");
  const hour = roundHours(moment(targetMoment).hour(), 6);
  const forecast = offset.toString().padStart(3, "0");
  const stamp = `${date}-${hour}.f${forecast}`;

  if (checkPath(`json-data/${stamp}.json`, false)) {
    console.log(`Already got ${stamp}, stopping harvest`);
    return;
  }

  const url = new URL(`${baseDir}`);
  const filesuffix = resolution === "1" ? `z.pgrb2.1p00.f${forecast}` : `z.pgrb2full.0p50.f${forecast}`;
  const file = `gfs.t${hour}${filesuffix}`;
  const params = {
    file,
    ...temp && {
      lev_surface: "on",
      var_TMP: "on",
    },
    ...wind && {
      lev_10_m_above_ground: "on",
      var_UGRD: "on",
      var_VGRD: "on",
    },
    leftlon: 0,
    rightlon: 360,
    toplat: 90,
    bottomlat: -90,
    dir: `/gfs.${date}/${hour}`,
  };
  Object.entries(params).forEach(([key, val]) => url.searchParams.append(key, val));

  fetch(url)
    .then((response) => {
      console.log(`RESP ${response.status} ${stamp}`);

      if (response.status !== 200) {
        nextFile(targetMoment, offset, false);
        return;
      }

      if (!checkPath(`json-data/${stamp}.json`, false)) {
        console.log("Write output");

        // Make sure output directory exists
        checkPath("grib-data", true);

        const file = fs.createWriteStream(`grib-data/${stamp}.f000`);
        response.body.pipe(file);
        file.on("finish", () => {
          file.close();
          convertGribToJson(stamp, targetMoment, offset);
        });
      } else {
        console.log(`Already have ${stamp}, not looking further`);
      }
    })
    .catch((err) => {
      console.log("ERR", stamp, err);
      nextFile(targetMoment, offset, false);
    });
}

function convertGribToJson(stamp, targetMoment, offset) {
  // Make sure output directory exists
  checkPath("json-data", true);

  exec(`${grib2json} --data --output json-data/${stamp}.json --names --compact grib-data/${stamp}.f000`,
    { maxBuffer: 500 * 1024 },
    (error) => {
      if (error) {
        console.log(`Exec error: ${error}`);
        return;
      }
      console.log("Converted");

      // Delete raw grib data
      exec("rm grib-data/*");

      nextFile(targetMoment, offset, true);
    });
}

/**
 *
 * Round hours to expected interval, e.g. we're currently using 6 hourly interval
 * i.e. 00 || 06 || 12 || 18
 *
 * @param hours
 * @param interval
 * @returns {String}
 */
function roundHours(hours, interval) {
  if (interval > 0) {
    const result = (Math.floor(hours / interval) * interval);
    return result < 10 ? `0${result.toString()}` : result;
  }
  return hours;
}

/**
 * Sync check if path or file exists
 *
 * @param path {string}
 * @param mkdir {boolean} create dir if doesn't exist
 * @returns {boolean}
 */
function checkPath(path, mkdir) {
  try {
    fs.statSync(path);
    return true;
  } catch (e) {
    if (mkdir) {
      fs.mkdirSync(path);
    }
    return false;
  }
}

/**
 *
 * @param targetMoment {Object} moment to check for new data
 */
function run(targetMoment) {
  getGribData(targetMoment, 0);
}

// Check for new data every 15 mins
setInterval(() => {
  run(moment.utc());
}, 900000);

// Init harvest
run(moment.utc());
