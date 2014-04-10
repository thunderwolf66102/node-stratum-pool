var events = require('events');

/*

Vardiff ported from stratum-mining share-limiter
 https://github.com/ahmedbodi/stratum-mining/blob/master/mining/basic_share_limiter.py

 */


function RingBuffer(maxSize){
    var data = [];
    var cursor = 0;
    var isFull = false;
    this.append = function(x){
        if (isFull){
            data[cursor] = x;
            cursor = (cursor + 1) % maxSize;
        }
        else{
            data.push(x);
            cursor++;
            if (data.length === maxSize){
                cursor = 0;
                isFull = true;
            }
        }
    };
    this.avg = function(){
        var sum = data.reduce(function(a, b){ return a + b });
        return sum / (isFull ? maxSize : cursor);
    };
    this.size = function(){
        return isFull ? maxSize : cursor;
    };
    this.clear = function(){
        data = [];
        cursor = 0;
        isFull = false;
    };
}

var varDiff = module.exports = function varDiff(port, varDiffOptions){
    var _this = this;

    var networkDifficulty;

    var bufferSize, tMin, tMax;

    //if (!varDiffOptions) return;

    var variance = varDiffOptions.targetTime * (varDiffOptions.variancePercent / 100);


    bufferSize = varDiffOptions.retargetTime / varDiffOptions.targetTime * 4;
    tMin       = varDiffOptions.targetTime - variance;
    tMax       = varDiffOptions.targetTime + variance;

    this.setNetworkDifficulty = function(diff){
        networkDifficulty = diff;
    };


    this.manageClient = function(client){

        var stratumPort = client.socket.localPort;

        if (stratumPort != port) {
            console.error("Handling a client which is not of this vardiff?");
        }
        var options = varDiffOptions;

        var lastTs;
        var lastRtc;
        var timeBuffer;

        client.on('submit', function(){

            var ts = (Date.now() / 1000) | 0;

            if (!lastRtc){
                lastRtc = ts - options.retargetTime / 2;
                lastTs = ts;
                timeBuffer = new RingBuffer(bufferSize);
                return;
            }

            var sinceLast = ts - lastTs;

            timeBuffer.append(sinceLast);
            lastTs = ts;
/* Do we retarget? */
            if ((ts - lastRtc) < options.retargetTime && timeBuffer.size() > 0)
                return;

            lastRtc = ts;
            var avg = timeBuffer.avg();
            var ddiff;

            if (avg < 1) {
                avg = 1
            }
/* Figure out delta diff */
            ddiff = client.difficulty * avg - client.difficulty
            if (avg > tMax && client.difficulty > options.minDiff) {
                if (ddiff > -1)
                    ddiff = -1;
/* Don't drop below minimum difficulty */
                if (ddiff + client.difficulty < options.minDiff) {
                    ddiff = options.minDiff - client.difficulty;
                }
            } else if (avg < tMin) {
                if (ddiff < 1)
                    ddiff = 1;
                var diffMax = options.maxDiff;
                if (ddiff + client.difficulty > diffMax) {
                    ddiff = diffMax - client.difficulty;
                }
            }
            else {
                return;
            }

            var newDiff = client.difficulty + ddiff;
            timeBuffer.clear();
            _this.emit('newDifficulty', client, newDiff);
        });
    };
};
varDiff.prototype.__proto__ = events.EventEmitter.prototype;
