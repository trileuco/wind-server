# Wind Server

Simple REST web service to expose [GRIB2](http://en.wikipedia.org/wiki/GRIB) wind forecast data 
(0.5 or 1 degree resolution, 6 hourly from [NOAA](http://nomads.ncep.noaa.gov/)) as pre-formatted JSON. <br/>
It is usually consumed by [Leaflet velocity layers](https://github.com/danwild/leaflet-velocity).

It relies on the [grib2json](https://github.com/claustres/grib2json) CLI for data conversion. The 0.8 version of the converter is embedded in the project, if you want to use your own simply define the GRIB2JSON environment variable pointing to your grib2json command in the execution context.

The following environment variables might be used to customize behaviour:
 - PORT for the port number the server will listen on
 - RESOLUTION for the requested input data resolution, could be '1' or '0.5' degree

Adapted from [wind-js-server](https://github.com/danwild/wind-js-server).

## Build Setup

``` bash
# install dependencies
$ npm install

# start
$ npm start

# build docker image
$ docker build -t claustres/wind-server .

# run container
$ docker run --name windserver -d claustres/wind-server
```

## License

MIT License (MIT)
