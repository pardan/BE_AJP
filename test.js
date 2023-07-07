
const mqtt = require('async-mqtt')
const MQTT_HOST = 'tcp://localhost:1883'
const NodeRSA = require('node-rsa');

const pub_key = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6ddRB6XyKpc2ug6uUMi/
D7+ztIHJpG19khgzxK3BBKoVE4owrhQECuewio7MwjXbuUg0e9Pq+qw1U0tmYWdU
DiuGlwUKsNsKIOCv3bwDxwKN4L0aPQb6D7wKozHEm35H58BYZxdRmmgjgAaRXEpx
4bgvMu89OdhwmXF959lXW9yQP6h9nsWmSh5VlDweyHz7GK6IyKgko18dkkdeXIP+
ViQ3FhshB87ySa6OT/3PFiqb4JvCZ/69rWwc8TK3YSImWD0eyR3bc7Q2t4AR+oKh
/Tr8iUNCwA+eJPBxc3OxpeGJhPqCwfqgSnfHgREZsvQRmUMBUO3gnfI82PTYuhkZ
UQIDAQAB
-----END PUBLIC KEY-----`;

const key = new NodeRSA(pub_key)


const client = mqtt.connect(MQTT_HOST)

const buf = Buffer.alloc(9)

client.on('connect', function () {

    buf.writeFloatBE(104.143367, 0);
    buf.writeFloatBE(-6.391730, 4);
    buf.writeUInt8(80, 8);

    setInterval(() => {
        console.log('publish')
        client.publish('a', key.encrypt(buf), { qos: 0 });
    }, 5000)
})