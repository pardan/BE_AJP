const mqtt = require('async-mqtt');

const MQTT_HOST = 'tcp://127.0.0.1:1883';
const DEVID = 1;
const TOPIC = `st/${DEVID}`;
const TOPIC_HR = `hr/${DEVID}`;

const client = mqtt.connect(MQTT_HOST, {
    will: {
        payload: Buffer.from([0]),
        retain: true,
        topic: TOPIC
    }
});

client.on('connect', function () {
    client.publish(TOPIC, Buffer.from([1]), {
        retain: true
    });

    setInterval(() => {
        const data =  (Math.floor(Math.random() * 100) + 1);
        console.log('send', data);
        client.publish(TOPIC_HR, Buffer.from([data]));
    }, 1000);
});