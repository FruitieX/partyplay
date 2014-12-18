var config;
var creds = require(process.env.HOME + '/.googlePlayCreds.json');
var PlayMusic = require('playmusic');
var mkdirp = require('mkdirp');
var https = require('https');
var send = require('send');
var url = require('url');
var fs = require('fs');

var gmusicBackend = {};

var gmusicDownload = function(startUrl, songID, callback, errCallback) {
    var doDownload = function(streamUrl) {
        console.log('downloading song ' + songID);

        // download to incomplete/ directory, move it out of there once done
        // this is to safeguard against partyplay crashes and storing an
        // incomplete download in the song cache
        var incompleteFilePath = config.songCachePath + '/gmusic/incomplete/' + songID + '.mp3';
        var filePath = config.songCachePath + '/gmusic/' + songID + '.mp3';
        var songFd = fs.openSync(incompleteFilePath, 'w');

        var req = https.request(streamUrl, function(res) {
            res.on('data', function(chunk) {
                fs.writeSync(songFd, chunk, 0, chunk.length, null);
            });
            res.on('end', function() {
                if(res.statusCode === 302) { // redirect
                    console.log('redirected. retrying with new URL');
                    fs.closeSync(songFd);
                    fs.unlinkSync(incompleteFilePath);
                    gmusicDownload(res.headers.location, songID, callback, errCallback);
                } else if(res.statusCode === 200) {
                    console.log('download finished ' + songID);
                    fs.closeSync(songFd);
                    fs.renameSync(incompleteFilePath, filePath);
                    if(callback)
                        callback();
                } else {
                    console.log('ERROR: unknown status code ' + res.statusCode);
                    fs.closeSync(songFd);
                    fs.unlinkSync(incompleteFilePath);
                    if(errCallback)
                        errCallback();
                }
            });
        });
        req.on('error', function(e) {
            console.log('error ' + e + ' while fetching! reconnecting in 5s...');
            setTimeout(function() {
                gmusicBackend.init(function() {
                    console.log('error while fetching! now reconnected to gmusic');
                    gmusicBackend.pm.getStreamUrl(songID, function(streamUrl) {
                        gmusicDownload(streamUrl, songID, callback, errCallback);
                    });
                });
            }, 5000);
        });
        req.end();
    };

    if(startUrl) {
        doDownload(startUrl);
    } else {
        gmusicBackend.pm.getStreamUrl(songID, function(streamUrl) {
            doDownload(streamUrl);
        });
    }
};

// callbacks for in progress downloads are stored here
// this way we can reject any possible duplicate download requests
var pendingCallbacks = {};

// cache songID to disk.
// on success: callback must be called
// on failure: errCallback must be called with error message
gmusicBackend.prepareSong = function(songID, callback, errCallback) {
    var filePath = config.songCachePath + '/gmusic/' + songID + '.mp3';

    // song is already downloading
    if(pendingCallbacks[songID]) {
        pendingCallbacks[songID].successCallbacks.push(callback);
        pendingCallbacks[songID].errorCallbacks.push(errCallback);
        return;
    }

    if(fs.existsSync(filePath)) {
        // song was found from cache
        if(callback)
            callback();
        return;
    } else {
        // song had to be downloaded
        pendingCallbacks[songID] = {
            successCallbacks: [callback],
            errorCallbacks: [errCallback]
        }

        gmusicDownload(null, songID, function() {
            for(var i = 0; i < pendingCallbacks[songID].successCallbacks.length; i++)
                pendingCallbacks[songID].successCallbacks[i]();

            delete(pendingCallbacks[songID]);
        }, function() {
            for(var i = 0; i < pendingCallbacks[songID].errorCallbacks.length; i++)
                pendingCallbacks[songID].errorCallbacks[i]();

            delete(pendingCallbacks[songID]);
        });
    }
};

// search for music from the backend
// on success: callback must be called with a list of song objects
// on failure: errCallback must be called with error message
gmusicBackend.search = function(terms, callback, errCallback) {
    gmusicBackend.pm.search(terms, config.searchResultCnt + 1, function(data) {
        var songs = [];

        if(data.entries) {
            songs = data.entries.sort(function(a, b) {
                return a.score < b.score; // sort by score
            }).filter(function(entry) {
                return entry.type === '1'; // songs only, no albums/artists
            });

            for(var i = 0; i < songs.length; i++) {
                songs[i] = {
                    artist: songs[i].track.artist,
                    title: songs[i].track.title,
                    album: songs[i].track.album,
                    duration: songs[i].track.durationMillis,
                    id: songs[i].track.nid,
                    backend: 'gmusic',
                    format: 'mp3'
                };
            }
        }

        callback(songs);
    }, function(err) {
        errCallback('error while searching gmusic: ' + err);
    });
};

// called when partyplay is started to initialize the backend
// do any necessary initialization here
gmusicBackend.init = function(_config, callback) {
    config = _config;
    mkdirp(config.songCachePath + '/gmusic/incomplete');

    // initialize google play music backend
    gmusicBackend.pm = new PlayMusic();
    gmusicBackend.pm.init(creds, callback);
};

// expressjs middleware for requesting music data
// must support ranges in the req, and send the data to res
gmusicBackend.middleware = function(req, res, next) {
    send(req, url.parse(req.url).pathname, {
        dotfiles: 'allow',
        root: config.songCachePath + '/gmusic'
    }).pipe(res);
};

module.exports = gmusicBackend;
