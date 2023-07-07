
const mqtt = require('async-mqtt')
const MQTT_HOST = 'tcp://localhost:1883'
const NodeRSA = require('node-rsa');

const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDp11EHpfIqlza6
Dq5QyL8Pv7O0gcmkbX2SGDPErcEEqhUTijCuFAQK57CKjszCNdu5SDR70+r6rDVT
S2ZhZ1QOK4aXBQqw2wog4K/dvAPHAo3gvRo9BvoPvAqjMcSbfkfnwFhnF1GaaCOA
BpFcSnHhuC8y7z052HCZcX3n2Vdb3JA/qH2exaZKHlWUPB7IfPsYrojIqCSjXx2S
R15cg/5WJDcWGyEHzvJJro5P/c8WKpvgm8Jn/r2tbBzxMrdhIiZYPR7JHdtztDa3
gBH6gqH9OvyJQ0LAD54k8HFzc7Gl4YmE+oLB+qBKd8eBERmy9BGZQwFQ7eCd8jzY
9Ni6GRlRAgMBAAECggEBAIa83CGuCqVjz9LRFrvRj9WBPgiqKAeoVwxRCbMv8uG/
JrnFjFshiVrHOT/9HBpjciGGa0dWSjT5+RfvgCRrp1Eq3zgxXYGeFG3xSSRYa0zG
Of3euDmlxXw/e1mhGYoG72OnvshX9Vsk2h+wqR0mgAvxVrDgjMTB489mR4fKAb4Z
dLsOkpaTUspJE1TUL1+3vsZ5eyquYcNknuoXe8yyzq9/XthZJhTGdQe4YSp5EnC9
jAt1IHgjYD2fBAtyQYV5ZQo4TSSojOyo1SCeqZ+3QCVQaWYSqx7Uk4gY1WMowgTz
N9agh4asD2beGJPnxhByjNAYi8heioq+upOQsoQVU0kCgYEA+SX5N+wnu0PEdtAH
k8OLJa5XwZsmmHV8vamRRzt4CSAAQjj4T/f7imKDjEX8HXxOpL5r7T15VTbAu+8v
vLdvdZ8sNPoPUuznILEIhHcn8W1GCshDMCs+EV/XN/FDlqgRqMvVytgLeiAhxAG4
6vrQ+6Cy04sQqF98L+3QKA9ILS8CgYEA8EWUHeU7Uv6thAvkkrGzaBBSWMhSPRRy
G3lTHP+sxF8PWFhexRcP/K4r8AAX+lgdGHejh1u2eV1Hez2Zg4Z3b4ygHCwqcJLp
HPUZkBmotPOU52fIwkppNsbU4RRSUcGyxpVRsPayFKQwyRZDTW2S+ffSYuOp69wS
QAvIp1xagX8CgYEAgQv7Js0J00QJiaS8l/uLogvIZn5PIl6QKsied+/Ef610lNhf
PURrpETccBZ7vGX7cfczfaD+rHV8pJsB9dRpRdoZEqOGtmQAXv1zNPFm3fTEd6c8
rcFoF6W1msM7R9hrtStG5Ba88xebhaOCvSsGfZ7BoTKBgURb1ZNu4qDvuH8CgYEA
7gJ+rv6cvaI7EEsXqZkON0+zwu7tSEQwpLaSdm9vHTdtY/5mIqat14hRTfVJy1vt
tocNHtDi+WZFoPdsUrWpKn8LO90kTU+6TE0ffXdtf5KrNm/Al3ZOs0xTJIOU6BgQ
mFbiDYLS9U+QZCIBmXmp1qR/bCZJ9LKUAY2qvt7laNECgYBoQ3PWC7hMRrigIblb
d2oihyNLzyJKxcCuloAztMQSNT0y3XVjc8qBCVpjeOEke8JGdVInXhcT4XMnFo2B
DrNF8SdEsHpHcsmuEq5ggxUfyqt3sRsL/6mfugh8JJgvnXL1aBsOOw3jbLqVxc8i
QQSFws7gulvjQ2DbdIiWlZMj9Q==
-----END PRIVATE KEY-----`

const key = new NodeRSA(privateKey);

const client = mqtt.connect(MQTT_HOST)

client.on('connect', function () {
    client.subscribe('a');
})

client.on('message', function(topic, data) {
    console.log(topic, key.decrypt(data));
})