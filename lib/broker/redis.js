const Redis = require("ioredis");
const { getLocalIp } = require("../utils/tool");
const { LRUCache } = require('lru-cache');

let redisCli;
let cache;
let isAlive = false;
const selfAddr = `${getLocalIp()}-${process.pid}`;
const CLIENT_ALIVE_EXPIRE_DUTATION = 20;
const PEER_EXPIRE_DUTATION = 10 * 60;
const BREAK_DURATION = 2 * 1000;

async function connect(host, port, username, password, db = 0) {
    redisCli = new Redis({
        port: port, // Redis port
        host: host, // Redis host
        username: username, // needs Redis >= 6
        password: password,
        db: db, // Defaults to 0
    });
    isAlive = true;
}

async function connectCluster(addrs, username, password) {
    redisCli = new Redis.Cluster(addrs, {
        redisOptions: {
            username,
            password,
        },
    });
    isAlive = true;
}

function updateClientCount(count) {
    console.warn(`set ${keyForStats(selfAddr)}`)
    redisCli.set(keyForStats(selfAddr), count, "EX", CLIENT_ALIVE_EXPIRE_DUTATION);
}

async function getNodeClientCount(addr) {
    let count = -1;
    try {
        count = await redisCli.get(keyForStats(addr));
    } catch (e) {
        console.error(e);
        takeABreak();
    }
    return Number(count)
}

function setLocalPeer(peerId) {
    if (!isAlive) return
    redisCli.set(keyForPeerId(peerId), selfAddr, "EX", PEER_EXPIRE_DUTATION);
}

function delLocalPeer(peerId) {
    if (!isAlive) return
    redisCli.del(keyForPeerId(peerId));
}

function updateLocalPeerExpiration(peerId) {
    if (!isAlive) return
    redisCli.expire(keyForPeerId(peerId), PEER_EXPIRE_DUTATION);
}

function keyForPeerId(peerId) {
    return `signal:peerId:${peerId}`
}

function keyForStats(addr) {
    return `signal:stats:count:${addr}`
}

function keyForMQ(addr) {
    return `signal:mq:${addr}`
}

function pushMsgToMQ(addr, msg) {
    redisCli.rpush(keyForMQ(addr), msg)
}

async function getLenMQ(addr) {
    let len = -1;
    try {
        len = await redisCli.llen(keyForMQ(addr))
    } catch (e) {
        console.error(e);
        takeABreak();
    }
    return len
}

function clearMQ(addr) {
    redisCli.ltrim(keyForMQ(addr), 1, 0);
}

function trimMQ(addr, len) {
    redisCli.ltrim(keyForMQ(addr), -len, -1);
}

async function blockPopMQ(timeout, addr) {
    const result = await redisCli.blpop(keyForMQ(addr), timeout);
    return result[1]
}

function initCache() {
    const options = {
        max: 100000,

        // for use with tracking overall storage size
        // maxSize: 5000,
        // sizeCalculation: (value, key) => {
        //     return 1
        // },

        // for use when you need to clean up something when objects
        // are evicted from the cache
        // dispose: (value, key) => {
        //     freeFromMemoryOrWhatever(value)
        // },

        // how long to live in ms
        // ttl: 1000 * 60 * 5,

        // return stale items before removing from cache?
        allowStale: false,

        updateAgeOnGet: false,
        updateAgeOnHas: false,
    }
    cache = new LRUCache(options)
}

async function getRemotePeerAddr(peerId) {
    const v = cache.get(peerId);
    if (!v) {
        const addr = await redisCli.get(keyForPeerId(peerId));
        if (addr) {
            cache.set(peerId, addr);
            return addr
        }
    }
    return v
}

function takeABreak() {
    isAlive = false;
    setTimeout(() => {
        isAlive = true;
    }, BREAK_DURATION)
}

module.exports = {
    connect,
    connectCluster,
    updateClientCount,
    getNodeClientCount,
    selfAddr,
    isAlive,
    setLocalPeer,
    delLocalPeer,
    updateLocalPeerExpiration,
    getRemotePeerAddr,
    getLenMQ,
    pushMsgToMQ,
    clearMQ,
    trimMQ,
}

