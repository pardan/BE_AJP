// IMPORTS
const sqlite3 = require("sqlite3").verbose();
const mqtt = require("async-mqtt");
const util = require("util");
const { ApolloServer, gql, PubSub } = require("apollo-server");
const { fromEvent, interval } = require("rxjs");
const { bufferTime, filter, map, take, tap } = require("rxjs/operators");
const dayjs = require("dayjs");
const lowdb = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const squel = require("squel");

const { getPathLength } = require("geolib");

require("dayjs/locale/id");
// END  IMPORT -

// CONFIG
const MQTT_HOST = "tcp://localhost:1883";
const COUNDOWN_TIME = 60 * 12; // 12 menit
const DISTANCE = "distance";
const HEART_RATES = "heartRates";
const ONLINE_STATUS = "onlineStatus";
const GPS_STATUS = "gpsStatus";
const OFFBODY_STATUS = "offBodyStatus";
const ONGOING_TIMER = "onGoingTimer";
const BATTERY_LEVEL = "batteryLevel";
const FINISH_STATUS = "finishStatus";
//AS
const SOTKAW = "sotKaw";
//AS
var DISTANCE_LIMIT = null;
var MODE = null;
//var temp_distance = 0;

const DB_SCHEMA = [
  `PRAGMA foreign_keys = ON`,
  `CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        devId STRING UNIQUE,
        code TEXT UNIQUE
    )`,
  `CREATE TABLE IF NOT EXISTS chips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chipId TEXT UNIQUE,
        codeChip TEXT UNIQUE
    )`,
  `CREATE TABLE IF NOT EXISTS test_category (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT
    )`,
  `CREATE TABLE IF NOT EXISTS satuan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        satuan TEXT UNIQUE,
        description TEXT
    )`,
  `CREATE TABLE IF NOT EXISTS pangkat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_satuan INTEGER NOT NULL,
        pangkat TEXT,
        FOREIGN KEY (id_satuan) REFERENCES satuan(id)
            ON DELETE CASCADE
    )`,
  `CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fullname TEXT,
        gender TEXT, -- [MALE,FEMALE]
        weight INTEGER, -- kg
        height INTEGER, -- cm
        birthDate TEXT,
        id_pangkat INTEGER,
        jabatan TEXT,
        kesatuan TEXT,
        NRP TEXT UNIQUE,
        FOREIGN KEY (id_pangkat) REFERENCES pangkat(id)
            ON DELETE SET NULL
    )`,
  `CREATE TABLE IF NOT EXISTS tests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode INTEGER, -- 1: 12 Menit, 2: 2400 Meter, 3: 3200 Meter
        eventName String NOT NULL,
        timeScheduled INTEGER NOT NULL,
        startTimestamp INTEGER,
        finishTimestamp INTEGER,
        location TEXT,
        coach TEXT,
        committee TEXT,
        category INTEGER,
        status TEXT, -- PENDING|ONGOING|ENDED
        FOREIGN KEY (category) REFERENCES test_category(id)
            ON DELETE SET NULL
    )`,
  `CREATE TABLE IF NOT EXISTS test_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_id INTEGER NOT NULL,
        participant_id INTEGER NOT NULL,
        participant_number TEXT NOT NULL,
        device_id INTEGER NOT NULL,
        chip_id INTEGER NOT NULL,
        distance INTEGER,
        canceled INTEGER DEFAULT 0,
        time TEXT,
        finished INTEGER,
        score INTEGER,
        lastlat REAL,
        lastlon REAL,
        FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
        FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        FOREIGN KEY (chip_id) REFERENCES chips(id) ON DELETE CASCADE 
    )`,
  `CREATE TABLE IF NOT EXISTS heart_rate_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_participant_id INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        hr_value INTEGER NOT NULL,
        FOREIGN KEY (test_participant_id) REFERENCES test_participants(id) 
            ON DELETE CASCADE
    )`,
  `CREATE TABLE IF NOT EXISTS gps_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_participant_id INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL NOT NULL,
        distanceTotal REAL NOT NULL,
        lastDistance REAL NOT NULL,
        FOREIGN KEY (test_participant_id) REFERENCES test_participants(id) 
            ON DELETE CASCADE
    )`,
   `CREATE TABLE IF NOT EXISTS chips_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_participant_id INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        reader_id INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS readers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        readerId TEXT UNIQUE,
        codeReader TEXT UNIQUE,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        centerlatitude REAL,
        centerlongitude REAL
    )`,
];
// END CONFIG
// END QUERY DEFINITIONS

// TYPE DEFINITIONS
const typeDefs = gql`
  scalar Date

  enum Gender {
    MALE
    FEMALE
  }

  enum Command {
    START
    STOP
  }

  enum TestStatus {
    PENDING
    ONGOING
    ENDED
    CANCELED
  }

  enum OngoingTestStatus {
    PREP
    START
    FINISH
  }

  type TestCategory {
    id: Int
    category: String
  }

  type DashboardData {
    totalTest: Int
    endedTest: Int
    totalParticipants: Int
    avgHeartRate: Int
    peakMileage: Int
  }

  type ParticipantTest {
    id: ID
    testId: ID
    testName: String
    testDate: Date
    deviceName: String
    age: Int
    threshold: Int
    avgHeartRate: Int
    peakHeartRate: Int
    mileage: Int
    duration: String
    score: String
    mode: Int
  }

  type Participant {
    id: ID
    fullname: String
    gender: Gender
    weight: Int
    height: Int
    birthDate: Date
    NRP: String
    jabatan: String
    kesatuan: String
    idSatuan: ID
    idPangkat: ID
    pangkat: String
    satuan: String
  }

  type TestParticipantDetail {
    id: ID
    participantId: ID
    deviceId: ID
    fullname: String
    code: String
    number: String
  }

  type Satuan {
    id: ID
    satuan: String
    description: String
  }

  type Pangkat {
    id: ID
    pangkat: String
  }

  type Test {
    id: ID
    mode: Int
    eventName: String
    timeScheduled: Date
    startTimestamp: Date
    finishTimestamp: Date
    status: TestStatus
    location: String
    coach: String
    committee: String
    category: TestCategory
    participantDetail: [TestParticipantDetail]
  }

  type Device {
    id: ID
    code: String
    devId: String
    isOnline: Boolean
    isWeared: Boolean
    heartRate: Int
  }

  input DeviceInput {
    devId: String
    code: String
  }

  type Chip {
    id: ID
    codeChip: String
    chipId: String
  }

  input ChipInput {
    chipId: String
    codeChip: String
  }

  type Reader {
    id: ID
    codeReader: String
    readerId: String
    latitude: Float
    longitude: Float
  }

  input ReaderInput {
    latt1: Float
    lonn1: Float
    latt2: Float
    lonn2: Float
    latt3: Float
    lonn3: Float
    latt4: Float
    lonn4: Float
    centerlat1: Float
    centerlon1: Float
    centerlat2: Float
    centerlon2: Float
  }

  type TestParticipant {
    id: ID
    number: String
    testParticipantId: ID
    code: String
    isOnline: Boolean
    isWeared: Boolean
    isGpsReady: Boolean
    isFinished: Boolean
    heartRate: Int
    battery: Int
    distance: Float
    heartRateThreshold: Int
    fullname: String
    age: Int
    timestamp: Int
    waktu: Int
    WAKTOS: Int
    lastlat: Float
    lastlon: Float
  }

  type TestParticipantResult {
    fullname: String
    number: String
    deviceName: String
    age: Int
    threshold: Int
    avgHeartRate: Int
    peakHeartRate: Int
    mileage: Int
    participantId: ID
    duration: String
    score: String
  }

  input ParticipantInput {
    fullname: String
    gender: Gender
    weight: Int
    height: Int
    birthDate: Date
    idPangkat: ID
    NRP: String
    jabatan: String
    kesatuan: String
  }

  input TestParticipantInput {
    participantId: Int
    number: String
    deviceId: Int
    deviceChipId: Int
  }

  input TestEdit {
    id: ID
    mode: Int
    eventName: String
    timeScheduled: Date
    participants: [TestParticipantInput]
    location: String
    coach: String
    committee: String
    category: ID
  }

  type OngoingTimer {
    id: ID
    timer: String
  }

  type HeartRateData {
    fullname: String
    data: [Int]
  }

  type HeartRateSeries {
    labels: [String]
    data: [HeartRateData]
  }

  type BackgroundColor {
    value: Int
  }

  type BackgroundColors {
    value: String
  }

  type ChartDataSet {
    label: String
    backgroundColor: [String]
    data: [Int]
  }

  type ChartType {
    labels: [String]
    datasets: [ChartDataSet]
  }

  type ParticipantRank {
    fullname: String
    satuan: String
    pangkat: String
    kesatuan: String
    avg_score: Int
    avg_hr: Int
  }

  type ChartData {
    chartBySatuan: ChartType
    chartByGender: ChartType
    chartByScore: ChartType
    chartBySatuanScore: ChartType
    dataByParticipant: [ParticipantRank]
  }

  type Query {
    getDevices(query: String): [Device]
    getChips(query: String): [Chip]
    getReaders(query: String): [Reader]
    device(id: ID): Device
    chip(id: ID): Chip
    reader(id: ID): Reader
    participants(
      query: String
      satuan: ID
      pangkat: ID
      gender: Gender
    ): [Participant]
    getParticipant(id: ID): Participant
    getTests(query: String, mode: Int, category: ID): [Test]
    getTest(id: ID): Test
    ongoingTest: Test
    ongoingTestParticipants: [TestParticipant]
    onGoingTimer: OngoingTimer
    dashboardData: DashboardData
    chartData(mode: Int, start: String, end: String): ChartData
    testParticipantResults(id: ID): [TestParticipantResult]
    lastFinishedTest: Test
    heartRateSeries(id: ID, testParticipantId: ID): HeartRateSeries
    participantTests(id: ID): [ParticipantTest]
    satuan: [Satuan]
    pangkat(satuan: ID): [Pangkat]
    categories: [TestCategory]
    category(id: ID): TestCategory
  }

  type Mutation {
    addTest(
      eventName: String
      timeScheduled: Date
      mode: Int
      coach: String
      committee: String
      location: String
      category: ID
      participants: [TestParticipantInput]
    ): ID
    startTest: Boolean
    finishTest: Boolean
    endTest: Boolean
    addDevice(device: DeviceInput): Boolean
    addChip(chip: ChipInput): Boolean
    addReader(reader: ReaderInput): Boolean
    deleteDevice(id: ID): Boolean
    deleteChip(id: ID): Boolean
    editDevice(id: ID, device: DeviceInput): Boolean
    editChip(id: ID, chip: ChipInput): Boolean
    beginTest(testId: ID): Boolean
    deleteTest(id: ID): Boolean
    addParticipant(participant: ParticipantInput): ID
    deleteParticipant(id: ID): Boolean
    updateParticipant(id: ID, participant: ParticipantInput): Boolean
    updateTest(test: TestEdit): Boolean
    assignDevice(
      status: OngoingTestStatus
      devId: ID
      chipId: ID
      participantId: ID
    ): Boolean
    sendCommandToDevices(cmd: Command): Boolean
    testTimer: Boolean
    addCategory(category: String): Boolean
    deleteCategory(id: ID): Boolean
    updateCategory(id: ID, category: String): Boolean
    cancelTestParticipant(id: ID): Boolean
    cancelTest(id: ID): Boolean
  }

  type Subscription {
    heartRates: [TestParticipant]
    onlineStatus: [TestParticipant]
    distance: [TestParticipant]
    finishStatus: [TestParticipant]
    offBodyStatus: [TestParticipant]
    gpsStatus: [TestParticipant]
    onGoingTimer: OngoingTimer
    batteryLevel: [TestParticipant]
    sotKaw: [TestParticipant]
  }
`;

const Q_GET_ONGOING_PARTICIPANTS = `
    select tp.*, 
            d.devId, 
            d.code,
            p.fullname,
            p.birthDate,
            p.gender
    from tests t
    join test_participants tp on t.id = tp.test_id and tp.canceled = 0
    join devices d on d.id = tp.device_id
    join participants p ON tp.participant_id = p.id
    where t.status = "ONGOING"
`;

const Q_GET_ONGOING_DEVICE = `
    SELECT p.id, t.startTimestamp, tp.id test_participant_id, tp.device_id, t.finishTimestamp, d.code FROM tests t
    JOIN test_participants tp 
        ON tp.test_id = t.id AND tp.canceled = 0
    JOIN devices d ON tp.device_id = d.id AND d.devId = ?
    JOIN participants p ON p.id = tp.participant_id
    WHERE status = "ONGOING"`;

/**
 *
 * MAIN PROGRAM
 */
const Query = {
  onGoingTimer: getOngoingTimer,
  getTests,
  getTest,
  getDevices,
  device,
  getChips,
  chip,
  getReaders,
  reader,
  participants: getParticipants,
  ongoingTest: getOngingTest,
  ongoingTestParticipants: getOngoingTestParticipants,
  getParticipant,
  dashboardData: getDashboardData,
  chartData: getChartData,
  testParticipantResults: getTestParticipantResults,
  lastFinishedTest: getLastFinishedTest,
  heartRateSeries: getHeartRateSeries,
  participantTests: getParticipantTests,
  satuan: getSatuan,
  pangkat: getPangkat,
  categories: getCategories,
  category: getCategory,
};

const Mutation = {
  addTest,
  updateTest,
  addDevice,
  editDevice,
  deleteDevice,
  addChip,
  editChip,
  deleteChip,
  addReader,
  deleteTest,
  beginTest,
  cancelTestParticipant,
  cancelTest,
  startTest,
  finishTest,
  endTest,
  addParticipant,
  deleteParticipant,
  updateParticipant,
  assignDevice,
  sendCommandToDevices,
  testTimer,
  addCategory,
  deleteCategory,
  updateCategory,
};

const Subscription = {
  [HEART_RATES]: {
    subscribe: () => PUBSUB.asyncIterator(HEART_RATES),
  },
  [ONLINE_STATUS]: {
    subscribe: () => PUBSUB.asyncIterator(ONLINE_STATUS),
  },
  [OFFBODY_STATUS]: {
    subscribe: () => PUBSUB.asyncIterator(OFFBODY_STATUS),
  },
  [DISTANCE]: {
    subscribe: () => PUBSUB.asyncIterator(DISTANCE),
  },
  [GPS_STATUS]: {
    subscribe: () => PUBSUB.asyncIterator(GPS_STATUS),
  },
  [ONGOING_TIMER]: {
    subscribe: () => PUBSUB.asyncIterator(ONGOING_TIMER),
  },
  [BATTERY_LEVEL]: {
    subscribe: () => PUBSUB.asyncIterator(BATTERY_LEVEL),
  },
  [FINISH_STATUS]: {
    subscribe: () => PUBSUB.asyncIterator(FINISH_STATUS),
  },
  [SOTKAW]: {
    subscribe: () => PUBSUB.asyncIterator(SOTKAW),
  },
};

dayjs.locale("id");

var currentTimer = null;
var currentTimer2 = null;
var ongoingTimer = null;
const adapter = new FileSync("store.json");
const STORE = lowdb(adapter);
const idMappings = new Map();
const PUBSUB = new PubSub();
const client = mqtt.connect(MQTT_HOST);
const DB = new sqlite3.Database("./db.sqlite3");
DB.pGet = util.promisify(DB.get);
DB.pAll = util.promisify(DB.all);
DB.pRun = util.promisify(DB.run);
const server = new ApolloServer({
  typeDefs,
  resolvers: {
    Query,
    Mutation,
    Subscription,
  },
});

STORE.defaults({
  online: [],
  onbody: [],
  gps: [],
  gps_log: [],
  ongoingTest: null,
}).write();

const ONLINE = STORE.get("online");
const ST_GPS = STORE.get("gps");
const GPS_LOG = STORE.get("gps_log");

Date.getUnixTime = () => (new Date().getTime() / 1000) | 0;

DB.serialize(() => DB_SCHEMA.forEach((sql) => DB.run(sql)));

server.listen(4000, "0.0.0.0").then(onServerListening);

const onConnect = fromEvent(client, "connect");
const onMessage = fromEvent(client, "message");

onConnect.subscribe(() =>
  client.subscribe([
    "hr/#", // heart rate
    "st/+", // online status
    "ob/+", // off-body
    "gps/#",
    "st_gps/+",
    "bat/+",
    "gps_test/+",
    "chip/#"
  ])
);

onMessage
  .pipe(
    filter((data) => data[0].startsWith("bat/")),
    map((data) => ({
      devId: String(data[0].split("/")[1]),
      battery: data[1].readUInt8(),
    }))
  )
  .subscribe(async (data) => {
    PUBSUB.publish(BATTERY_LEVEL, {
      [BATTERY_LEVEL]: [
        Object.assign(data, {
          id: await getDeviceId(data.devId),
          battery: data.battery,
          isOnline: true,
        }),
      ],
    });
  });

var onStGPS = onMessage.pipe(
  filter((data) => data[0].startsWith("st_gps/")),
  map((data) => ({
    devId: String(data[0].split("/")[1]),
    isGpsReady: data[1].readUInt8(),
  }))
);

onStGPS.subscribe(async (gpsStatus) => {
  PUBSUB.publish(GPS_STATUS, {
    [GPS_STATUS]: [
      Object.assign(gpsStatus, {
        id: await getDeviceId(gpsStatus.devId),
        isOnline: true,
      }),
    ],
  });
});

onStGPS.subscribe(({ devId, isGpsReady }) => {
  if (isGpsReady && !ST_GPS.some((x) => x == devId).value()) {
    ST_GPS.push(devId).write();
  } else {
    ST_GPS.remove((x) => x == devId).write();
  }
});

onMessage
  .pipe(
    filter((data) => data[0].startsWith("ob/")),
    map((data) => ({
      devId: String(data[0].split("/")[1]),
      isWeared: data[1].readUInt8(),
    }))
  )
  .subscribe((offBodyStatus) => {
    PUBSUB.publish(OFFBODY_STATUS, {
      [OFFBODY_STATUS]: [
        Object.assign(offBodyStatus, {
          id: idMappings.get(offBodyStatus.devId),
          isWeared: offBodyStatus.isWeared,
          isOnline: true,
        }),
      ],
    });
  });

const onOnlineStatus = onMessage.pipe(
  filter((data) => data[0].startsWith("st/")),
  map((data) => ({
    devId: String(data[0].split("/")[1]),
    isOnline: data[1].readUInt8(),
  }))
);

onOnlineStatus.subscribe(({ devId, isOnline }) => {
  if (isOnline && !ONLINE.some((x) => x == devId).value()) {
    ONLINE.push(devId).write();
  } else {
    ONLINE.remove((x) => x == devId).write();
  }
});

onOnlineStatus.pipe(filter((x) => !x.isOnline)).subscribe(({ devId }) =>
  client.publish(`st_gps/${devId}`, Buffer.from([0]), {
    retain: true,
    qos: 0,
  })
);

onOnlineStatus.subscribe(({ devId, isOnline }) =>
  console.log(`${devId} ${isOnline ? "Online" : "Offline"}`)
);

const getStatus = (startTimestamp, finishTimestamp) =>
  finishTimestamp ? "FINISH" : startTimestamp ? "START" : "PREP";

// on device online check for assignment363
onOnlineStatus.pipe(filter((x) => x.isOnline)).subscribe(({ devId }) => {
  // cek apakah device sudah teregister

  // cek apakah device ini sedang digunakan di test yang sedang ongoing
  DB.get(Q_GET_ONGOING_DEVICE, [devId], function (err, row) {
    if (!err && row) {
      assignDevice(null, {
        status: getStatus(row.startTimestamp, row.finishTimestamp),
        devId: devId,
        participantId: row.id,
        testParticipantId: row.test_participant_id,
        code: row.code,
      }).then((_) => console.log("device assigned", devId, row.id));
    } else {
      // check whether device is registered
      DB.get(
        "SELECT * FROM devices WHERE devId = ?",
        [devId],
        function (err, row) {
          if (err) console.error(err);

          if (row) {
            client.publish(`cf/${devId}`, `READY,${row.code}`);
          } else {
            client.publish(`cf/${devId}`, "UNREG");
          }
        }
      );
    }
  });
});

onOnlineStatus.subscribe((onlineStatus) => {
  PUBSUB.publish(ONLINE_STATUS, {
    [ONLINE_STATUS]: [
      {
        id: String(idMappings.get(onlineStatus.devId)),
        isOnline: onlineStatus.isOnline,
      },
    ],
  });
});

const onGPS = onMessage.pipe(
  filter((data) => data[0].startsWith("gps/")),
  map((data) => data.concat([Date.getUnixTime()])),
  bufferTime(500),
  filter((data) => data.length),
  map((all) =>
    all.map((data) => {
      const [, deviceId, testParticipantId] = data[0].split("/");
      const [latitude, longitude, accuracy] = data[1].toString().split(",");
      console.log(deviceId, testParticipantId, latitude, longitude, accuracy)

      const current = GPS_LOG.find({
        id: deviceId,
      });

      const point = {
        longitude: parseFloat(longitude),
        latitude: parseFloat(latitude),
      };

      if (current.value() == undefined) {
        GPS_LOG.push({
          id: deviceId,
          data: [point],
        }).write();
      } else {
        current.get("data").push(point).write();
      }

      const distance = getPathLength(current.get("data").value());

      return {
        devId: String(deviceId),
        testParticipantId: testParticipantId ? Number(testParticipantId) : null,
        gps: {
          ...point,
          accuracy: parseFloat(accuracy),
          distance,
          lastDistance: 0,
        },
        timestamp: data[3],
      };
    })
  )
);

onGPS.subscribe((gpsData) => {
  DB.serialize(() =>
    gpsData
      .filter(({ testParticipantId }) => testParticipantId !== null)
      .forEach(({ testParticipantId, timestamp, gps }) => {
        DB.run(
          `
                        INSERT INTO gps_logs (
                            test_participant_id, 
                            timestamp, 
                            latitude, 
                            longitude, 
                            accuracy, 
                            distanceTotal, 
                            lastDistance
                        ) 
                        VALUES(?,?,?,?,?,?,?)`,
          [
            testParticipantId,
            timestamp,
            gps.latitude,
            gps.longitude,
            gps.accuracy,
            gps.distance,
            gps.lastDistance,
          ],
          function (err) {
            if (err) {
              console.log(err);
            }
          }
        );

        DB.run(
          "UPDATE test_participants SET lastlat = ?, lastlon = ? WHERE id = ?",
          [gps.latitude, gps.longitude, testParticipantId],
          function (err) {
            if (err) {
              console.log(err);
            }
          }
        );
      })
  );
});

/////////////////////////////////////////////////////////////////////fungsi graph chip log /////////////////////////////////////////////
const onChip = onMessage.pipe(
  filter((data) => data[0].startsWith("chip/")),
  map((data) => data.concat([Date.getUnixTime()])),
  bufferTime(500),
  filter((data) => data.length),
  map((all) =>
    all.map((data) => {
      const [, chipId, testParticipantId] = data[0].split("/");
      console.log("Received Chip Id:", chipId);
      console.log("Received Tes Participant Id:", testParticipantId);
      //console.log('Received Reader Id:', parseInt(data[1].toString()));

      const pointReader = parseInt(data[1].toString());
      console.log("Received pointReader:", pointReader);
      let temp_distance = 0;
      switch (pointReader) {
        case 1:
          //ZONE D
          temp_distance = temp_distance + 115.61;
          DB.run(
            "UPDATE test_participants SET distance = ? WHERE participant_id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
            [temp_distance,testParticipantId, chipId],
            (error) => {
              if (error) {
                console.error("Error updating distance:", error);
              } else {
                console.log("Distance updated successfully");
              }
            }
          );
          console.log("Received pointReader:", temp_distance);
          break;
        case 2:
          //ZONE A
          temp_distance = temp_distance + 84.39;
          DB.run(
            "UPDATE test_participants SET distance = ? WHERE participant_id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
            [temp_distance,testParticipantId, chipId],
            (error) => {
              if (error) {
                console.error("Error updating distance:", error);
              } else {
                console.log("Distance updated successfully");
              }
            }
          );
          break;
        case 3:
          //ZONE B
          temp_distance = temp_distance + 115.61;
          DB.run(
            "UPDATE test_participants SET distance = ? WHERE participant_id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
            [temp_distance,testParticipantId, chipId],
            (error) => {
              if (error) {
                console.error("Error updating distance:", error);
              } else {
                console.log("Distance updated successfully");
              }
            }
          );
          console.log("Received pointReader:", temp_distance);
          break;
        case 4:
          //ZONE B
          temp_distance = temp_distance + 84.39;
          DB.run(
            "UPDATE test_participants SET distance = ? WHERE participant_id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
            [temp_distance,testParticipantId, chipId],
            (error) => {
              if (error) {
                console.error("Error updating distance:", error);
              } else {
                console.log("Distance updated successfully");
              }
            }
          );
          console.log("Received pointReader:", temp_distance);
          break;
        default:
          console.log("Nilai yang diberikan tidak valid");
          break;

      }

      return {
        chipId: String(chipId),
        testParticipantId: testParticipantId ? Number(testParticipantId) : null,
        readerId: parseInt(data[1].toString()),
        timestamp: data[3],
      };
    })
  )
);

onChip.subscribe((chipStatus) =>
  DB.serialize(() =>
    chipStatus
      .filter(({ testParticipantId }) => testParticipantId !== null)
      .forEach(({ testParticipantId, timestamp, readerId }) => {
        DB.run(
          "INSERT INTO chips_logs (test_participant_id, timestamp, reader_id) VALUES (?, ?, ?)",
          [testParticipantId, timestamp, readerId],
          function (err) {
            if (err) {
              console.log(err);
            }
          }
        );
      })
  )
);

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// NOTIFY CLIENTS
onGPS.subscribe((gpsData) => {
  // TODO: Handler If Finished
  try {
    PUBSUB.publish(DISTANCE, {
      [DISTANCE]: gpsData.map(async ({ devId, gps }) => ({
        id: await getDeviceId(devId),
        isOnline: true,
        isWeared: true,
        isGpsReady: true,
        distance: gps.distance,
        WAKTOS: ongoingTimer,
      })),
    });

    const gpsLog = GPS_LOG.value();
    const updateIds = gpsData.map(({ devId }) => devId);

    gpsLog
      .filter(({ id }) => updateIds.includes(id))
      .forEach((gps) => {
        const distance = getPathLength(gps.data);

        if (MODE == 2 || MODE == 3) {
          if (distance >= DISTANCE_LIMIT) {
            DB.get(Q_GET_ONGOING_DEVICE, [gps.id], function (err, row) {
              if (!err && row) {
                DB.run(
                  "UPDATE test_participants SET distance = ?, time = ?, finished = ? WHERE id = ?",
                  [distance, ongoingTimer, 1, row.test_participant_id],

                  function (err) {
                    if (err) {
                      console.error(err);
                    }
                    assignDevice(null, {
                      status: "FINISH",
                      devId: gps.id,
                      participantId: row.id,
                      testParticipantId: row.test_participant_id,
                      code: row.code,
                    });

                    WAKTOS = ongoingTimer;

                    PUBSUB.publish(FINISH_STATUS, {
                      [FINISH_STATUS]: [
                        {
                          id: row.device_id,
                          isFinished: true,
                          //WAKTOS: ongoingTimer
                        },
                      ],
                    });

                    console.log("WAKTOS : ", WAKTOS);

                    PUBSUB.publish(SOTKAW, {
                      [SOTKAW]: [
                        {
                          WAKTOS: ongoingTimer,
                        },
                      ],
                    });
                  }
                );
              }
            });
          }
        }

        client.publish(`distance/${gps.id}`, String(distance));
      });
  } catch (error) {
    console.error(error);
  }
});

const onHeartRate = onMessage.pipe(
  filter((data) => data[0].startsWith("hr/")),
  map((data) => data.concat([Date.getUnixTime()])),
  bufferTime(500),
  filter((data) => data.length),
  map((all) =>
    all.map((data) => {
      const [, deviceId, testParticipantId] = data[0].split("/");

      return {
        devId: String(deviceId),
        testParticipantId: testParticipantId ? Number(testParticipantId) : null,
        heartRate: data[1].readUInt8(),
        timestamp: data[3],
      };
    })
  )
);

onHeartRate.subscribe((heartRates) =>
  DB.serialize(() =>
    heartRates
      .filter(({ testParticipantId }) => testParticipantId !== null)
      .forEach(({ testParticipantId, timestamp, heartRate }) => {
        DB.run(
          "INSERT INTO heart_rate_logs (test_participant_id, timestamp, hr_value) VALUES(?,?,?)",
          [testParticipantId, timestamp, heartRate],
          function (err) {
            if (err) {
              console.log(err);
            }
          }
        );
      })
  )
);

// PUBLISH TO WEBAPP
onHeartRate.subscribe((heartRates) =>
  PUBSUB.publish(HEART_RATES, {
    [HEART_RATES]: heartRates.map(({ devId, timestamp, heartRate }) => ({
      id: idMappings.get(devId),
      heartRate,
      isOnline: true,
      isWeared: true,
      timestamp,
    })),
  })
);

/**
 *
 * RESOLVERS
 **/

function getDevices(_, { query = null }) {
  return new Promise((resolve, reject) => {
    if (query) {
      DB.all(
        "SELECT * FROM devices WHERE code LIKE ?",
        ["%" + query + "%"],
        (err, rows) => {
          if (err) reject(err);

          resolve(rows);
        }
      );
    } else {
      DB.all("SELECT * FROM devices", (err, rows) => {
        if (err) reject(err);

        resolve(rows);
      });
    }
  });
}

async function device(_, { id }) {
  return DB.pGet(squel.select().from("devices").where("id = ?", id).toString());
}

//////////////////////////////////////////////////////////////////////Add Resolver Chip RFID////////////////////////////////////////////////////////////
function getChips(_, {
    query = null
}) {
    return new Promise((resolve, reject) => {
        if (query) {
            DB.all('SELECT * FROM chips WHERE codeChip LIKE ?', ['%' + query + '%'], (err, rows) => {
                if (err) reject(err)

                resolve(rows)
            })
        } else {
            DB.all('SELECT * FROM chips', (err, rows) => {
                if (err) reject(err)

                resolve(rows)
            })
        }
    })
}

async function chip(_, { id }) {
    return DB.pGet(squel.select().from('chip').where('id = ?', id).toString());
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function getReaders(_, { query = null }) {
    return new Promise((resolve, reject) => {
      if (query) {
        DB.all(
          "SELECT * FROM readers WHERE codeReader LIKE ?",
          ["%" + query + "%"],
          (err, rows) => {
            if (err) reject(err);
  
            resolve(rows);
          }
        );
      } else {
        DB.all("SELECT * FROM readers", (err, rows) => {
          if (err) reject(err);
  
          resolve(rows);
        });
      }
    });
}
  
async function reader(_, { id }) {
    return DB.pGet(squel.select().from("readers").where("id = ?", id).toString());
}


function getParticipants(
  _,
  { query = null, satuan = null, pangkat = null, gender = null }
) {
  return new Promise((resolve, reject) => {
    const q = squel
      .select()
      .fields([
        "p.*",
        "pan.id as idPangkat",
        "pan.pangkat as pangkat",
        "sat.id as idSatuan",
        "sat.satuan as satuan",
      ])
      .from("participants", "p")
      .left_join("pangkat", "pan", "p.id_pangkat = pan.id")
      .left_join("satuan", "sat", "pan.id_satuan = sat.id");

    if (query != null) {
      q.where("p.fullname LIKE ? OR p.NRP LIKE ?", `%${query}%`, `%${query}%`);
    }

    if (satuan != null) {
      q.where("pan.id_satuan = ?", satuan);
    }

    if (pangkat != null) {
      q.where("p.id_pangkat = ?", pangkat);
    }

    if (gender) {
      q.where("p.gender = ?", gender);
    }

    DB.all(q.toString(), function (err, rows) {
      if (err) reject(err);

      resolve(rows);
    });
  });
}

function addParticipant(_, { participant }) {
  return new Promise((resolve, reject) => {
    DB.run(
      `INSERT INTO participants(fullname, gender, weight, height, birthDate, id_pangkat, NRP, jabatan, kesatuan) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        participant.fullname,
        participant.gender,
        participant.weight,
        participant.height,
        participant.birthDate,
        participant.idPangkat,
        participant.NRP,
        participant.jabatan,
        participant.kesatuan,
      ],
      function (err) {
        if (err) reject(err);

        resolve(this.lastID);
      }
    );
  });
}

function deleteParticipant(_, { id }) {
  return new Promise((resolve, reject) => {
    DB.run(`DELETE FROM participants WHERE id = ?`, [id], function (err) {
      if (err) reject(err);

      resolve(true);
    });
  });
}

function updateParticipant(_, { id, participant }) {
  return new Promise((resolve, reject) => {
    const Q_UPDATE_PARTICIPANT = `
            UPDATE participants 
                SET fullname=?, 
                    gender=?, 
                    weight=?, 
                    height=?, 
                    birthDate=?,
                    NRP=?,
                    jabatan=?,
                    kesatuan=?,
                    id_pangkat=? 
                WHERE id = ?
        `;
    DB.run(
      Q_UPDATE_PARTICIPANT,
      [
        participant.fullname,
        participant.gender,
        participant.weight,
        participant.height,
        participant.birthDate,
        participant.NRP,
        participant.jabatan,
        participant.kesatuan,
        participant.idPangkat,
        Number(id),
      ],
      function onSuccess(err) {
        if (err) reject(err);

        resolve(true);
      }
    );
  });
}

function getParticipant(_, { id }) {
  return new Promise((resolve, reject) => {
    const QUERY = `
            SELECT 
                p.*, 
                pan.id as idPangkat,
                pan.pangkat as pangkat,
                sat.id as idSatuan,
                sat.satuan as satuan 
            FROM participants p
            LEFT JOIN pangkat pan ON p.id_pangkat = pan.id
            LEFT JOIN satuan sat ON pan.id_satuan = sat.id
            WHERE p.id = ?
        `;
    DB.get(QUERY, [id], function (err, participant) {
      if (err) reject(err);

      resolve(participant);
    });
  });
}

function getTests(_, { category = null, mode = null, query = null }) {
  return new Promise((resolve, reject) => {
    const q = squel
      .select()
      .fields(["t.*", "tc.id as category_id", "tc.category as category"])
      .from("tests", "t")
      .left_join("test_category", "tc", "t.category = tc.id")
      .order(
        `CASE WHEN status = 'ONGOING' THEN 1 WHEN status = 'PENDING' THEN 2 ELSE 3 END`,
        true
      );

    if (query != null) {
      q.where("t.eventName LIKE ?", "%" + query + "%");
    }

    if (category) {
      q.where("t.category = ?", category);
    }

    if (mode) {
      q.where("t.mode = ?", mode);
    }

    DB.all(q.toString(), function (err, rows) {
      if (err) reject(err);

      resolve(
        rows.map((row) => {
          const startTimestamp =
            row.startTimestamp == null
              ? null
              : dayjs(row.startTimestamp).format("YYYY-MM-DD HH:mm");
          const finishTimestamp =
            row.finishTimestamp == null
              ? null
              : dayjs(row.finishTimestamp).format("YYYY-MM-DD HH:mm");
          return Object.assign(row, {
            timeScheduled: dayjs(row.timeScheduled).format("YYYY-MM-DD HH:mm"),
            startTimestamp,
            finishTimestamp,
            category: {
              id: row.category_id,
              category: row.category,
            },
          });
        })
      );
    });
  });
}

async function getTest(_, { id }) {
  try {
    const test = await new Promise((resolve, reject) => {
      const Q_TEST = `
            SELECT 
                t.*,
                tc.id as categoryId,
                tc.category as categoryName
            FROM tests t
            LEFT JOIN test_category tc ON t.category = tc.id 
            WHERE t.id = ?
            `;

      DB.get(Q_TEST, [id], function (err, row) {
        if (err) reject(err);

        resolve(
          Object.assign(row, {
            category: {
              id: row.categoryId,
              category: row.categoryName,
            },
            timeScheduled: dayjs(row.timeScheduled).format("YYYY-MM-DD HH:mm"),
          })
        );
      });
    });

    const testParticipants = await new Promise((resolve, reject) => {
      DB.all(
        `            
                SELECT 
                    tp.id,
                    tp.participant_number,
                    tp.participant_id,
                    p.fullname,
                    d.code,
                    d.id as deviceId
                FROM test_participants tp 
                LEFT JOIN participants p ON tp.participant_id = p.id
                LEFT JOIN devices d ON tp.device_id = d.id
                WHERE test_id = ?
                GROUP BY tp.id`,
        [test.id],
        (err, rows) => {
          if (err) reject(err);

          resolve(
            rows.map((row) => ({
              id: row.id,
              number: row.participant_number,
              code: row.code,
              fullname: row.fullname,
              deviceId: row.deviceId,
              participantId: row.participant_id,
            }))
          );
        }
      );
    });

    return Object.assign(test, {
      participantDetail: testParticipants,
    });
  } catch (error) {
    return console.error(error);
  }
}

function getOngoingTimer() {
  return {
    id: "1",
    timer: "12:00",
  };
}

async function addTest(
  _,
  {
    eventName,
    timeScheduled,
    mode,
    coach,
    committee,
    location,
    participants,
    category,
  }
) {
  const testId = await new Promise((resolve, reject) => {
    DB.run(
      "INSERT INTO tests (eventName, mode, timeScheduled, status, coach, committee, location, category) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
      [
        eventName,
        mode,
        dayjs(timeScheduled).valueOf(),
        "PENDING",
        coach,
        committee,
        location,
        category,
      ],
      function (err) {
        if (err) reject(err);

        resolve(this.lastID);
      }
    );
  });

  DB.parallelize(function () {
    participants.forEach((p) => {
      DB.run(
        "INSERT INTO test_participants(test_id, participant_id, participant_number, device_id, chip_id) VALUES(?, ?, ?, ?, ?)",
        [testId, p.participantId, p.number, p.deviceId, p.deviceChipId]
      );
    });
  });

  return testId;
}

async function updateTest(_, { test }) {
  try {
    await new Promise((resolve, reject) => {
      DB.run(
        "UPDATE tests SET eventName = ?, mode = ?, timeScheduled = ?, coach = ?, committee = ?, location = ?, category = ? WHERE id = ?",
        [
          test.eventName,
          test.mode,
          dayjs(test.timeScheduled).valueOf(),
          test.coach,
          test.committee,
          test.location,
          test.category,
          test.id,
        ],
        (err) => {
          if (err) reject(err);

          resolve(true);
        }
      );
    });

    await new Promise((resolve, reject) => {
      DB.run(
        "DELETE FROM test_participants WHERE test_id = ?",
        [test.id],
        (err) => {
          if (err) reject(err);

          resolve(true);
        }
      );
    });

    DB.parallelize(function () {
      test.participants.forEach((p) => {
        DB.run(
          "INSERT INTO test_participants(test_id, participant_id, participant_number, device_id) VALUES(?, ?, ?, ?)",
          [test.id, p.participantId, p.number, p.deviceId]
        );
      });
    });

    return true;
  } catch (error) {
    console.error(error);
  }
}

function addDevice(_, { device }) {
  return new Promise((resolve, reject) => {
    DB.run(
      "INSERT INTO devices(devId,code) VALUES(?,?)",
      [device.devId, device.code],
      function (err) {
        if (err) reject(err);

        client.publish(`cf/${device.devId}`, `READY,${device.code}`);

        resolve(true);
      }
    );
  });
}

async function editDevice(_, { id, device }) {
  try {
    await DB.run(
      squel
        .update()
        .table("devices")
        .set("code", device.code)
        .set("devId", device.devId)
        .where("id = ?", id)
        .toString()
    );

    client.publish(`cf/${device.devId}`, `READY,${device.code}`);

    return true;
  } catch (error) {
    return false;
  }
}

function deleteDevice(_, { id }) {
  return new Promise((resolve, reject) => {
    DB.get("SELECT * FROM devices WHERE id = ?", [id], function (err, row) {
      if (err) reject(err);

      if (row) {
        DB.run("DELETE FROM devices WHERE id = ?", [id], function (err) {
          if (err) reject(err);

          client.publish(`cf/${row.devId}`, `UNREG`);

          resolve(true);
        });
      }
    });
  });
}

//////////////////////////////////////////Modifikasi Add Chip AS////////////////////////////////////////////////////////

function addChip(_, {
    chip
}) {
    return new Promise((resolve, reject) => {
        DB.run('INSERT INTO chips(chipId,codeChip) VALUES(?,?)', [chip.chipId, chip.codeChip],
            function (err) {
                if (err) reject(err)

                client.publish(`cf/${chip.chipId}`, `READY,${chip.codeChip}`)

                resolve(true)
            })
    })
}

async function editChip(_, { id, chip }) {
    try {
        await DB.run(squel.update()
            .table('chips')
            .set('codeChip', chip.codeChip)
            .set('chipId', chip.chipId)
            .where('id = ?', id)
            .toString());

        client.publish(`cf/${chip.chipId}`, `READY,${chip.codeChip}`);

        return true;
    } catch (error) {
        return false;
    }
}

function deleteChip(_, {
    id
}) {
    return new Promise((resolve, reject) => {
        DB.get('SELECT * FROM chips WHERE id = ?', [id], function (err, row) {
            if (err) reject(err)

            if (row) {
                DB.run('DELETE FROM chips WHERE id = ?', [id],
                    function (err) {
                        if (err) reject(err)

                        client.publish(`cf/${row.chipId}`, `UNREG`)

                        resolve(true)
                    })
            }
        })
    })
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function addReader(_, { reader }) {
    return new Promise((resolve, reject) => {
        DB.run(
            "DELETE FROM readers",
            function (err) {
              if (err) reject(err);
      
              resolve(true);
            }
          );
    
      DB.run(
        "INSERT INTO readers(readerId, codeReader, latitude, longitude) VALUES(?,?,?,?)",
        ["rf1", "RFID 1", reader.latt1, reader.lonn1],
        function (err) {
          if (err) reject(err);
  
          resolve(true);
        }
      );

      DB.run(
        "INSERT INTO readers(readerId, codeReader, latitude, longitude, centerlatitude, centerlongitude) VALUES(?,?,?,?,?,?)",
        ["rf2", "RFID 2", reader.latt2, reader.lonn2, reader.centerlat1, reader.centerlon1],
        function (err) {
          if (err) reject(err);
  
          resolve(true);
        }
      );

      DB.run(
        "INSERT INTO readers(readerId, codeReader, latitude, longitude) VALUES(?,?,?,?)",
        ["rf3", "RFID 3", reader.latt3, reader.lonn3],
        function (err) {
          if (err) reject(err);
  
          resolve(true);
        }
      );

      DB.run(
        "INSERT INTO readers(readerId, codeReader, latitude, longitude, centerlatitude, centerlongitude) VALUES(?,?,?,?,?,?)",
        ["rf4", "RFID 4", reader.latt4, reader.lonn4, reader.centerlat2, reader.centerlon2],
        function (err) {
          if (err) reject(err);
  
          resolve(true);
        }
      );
    });
  }

function beginTest(_, { testId }) {
  const setMode = new Promise((resolve, reject) => {
    DB.get(
      "SELECT * FROM tests WHERE id = ?",
      [Number(testId)],
      function (err, row) {
        if (err) reject(err);

        MODE = Number(row.mode);

        if (MODE == 2) {
          DISTANCE_LIMIT = 2400;
        } else if (MODE == 3) {
          DISTANCE_LIMIT = 3200;
        } else {
          DISTANCE_LIMIT = null;
        }

        resolve(true);
      }
    );
  });

  const assignDevices = new Promise((resolve, reject) => {
    DB.run(
      "UPDATE tests SET status = ? WHERE id = ?",
      ["ONGOING", Number(testId)],
      function (err) {
        if (err) reject(err);

        DB.all(
          `
                SELECT d.id, d.devId, d.code, participant_id 
                FROM test_participants tp
                JOIN devices d ON tp.device_id = d.id 
                WHERE test_id = ?`,
          [Number(testId)],
          function (err, rows) {
            if (err) reject(err);

            rows.forEach((r) => idMappings.set(r.devId, r.id));

            const assignDevices = Promise.all(
              rows.map((row) =>
                assignDevice(null, {
                  status: "PREP",
                  devId: row.devId,
                  participantId: row.participant_id,
                  testParticipantId: row.id,
                  code: row.code,
                })
              )
            );

            assignDevices.then((_) => resolve(true));
          }
        );
      }
    );
  });

  return Promise.all([setMode, assignDevices]).then((_) => true);
}

async function cancelTest(_, { id }) {
  try {
    const ongoingParticipants = await DB.pAll(Q_GET_ONGOING_PARTICIPANTS);

    await DB.pRun(
      squel
        .update()
        .table("tests")
        .set("status", "CANCELED")
        .where("id = ?", id)
        .toString()
    );

    STORE.setState({
      online: [],
      onbody: [],
      gps: [],
      gps_log: [],
      ongoingTest: null,
    }).write();

    ongoingParticipants.map((r) =>
      client.publish(`cf/${r.devId}`, `READY,${r.code}`)
    );

    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
}

async function cancelTestParticipant(_, { id }) {
  try {
    const tp = await DB.pGet(
      squel
        .select()
        .fields(["d.devId", "d.code", "p.gender", "p.birthDate"])
        .from("test_participants", "tp")
        .join("devices", "d", "tp.device_id = d.id")
        .join("participants", "p", "tp.participant_id = p.id")
        .where("tp.id = ?", id)
        .toString()
    );

    const test = await DB.pGet(
      squel.select().from("tests", "t").where('status = "ONGOING"').toString()
    );

    const current = GPS_LOG.find({
      id: tp.devId,
    });

    const distance = getPathLength(current.get("data").value());

    const score = String(
      getScore(
        test.mode,
        tp.gender,
        distance,
        ongoingTimer,
        getAge(tp.birthDate)
      )
    );

    await DB.pRun(
      squel
        .update()
        .table("test_participants")
        .setFields({
          distance: distance,
          time: ongoingTimer == null ? 0 : ongoingTimer,
          finished: 0,
          canceled: 1,
          score: score,
        })
        .where("id = ?", id)
        .toString()
    );

    client.publish(`cf/${tp.devId}`, `READY,${tp.code}`);

    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
}

function startTest() {
  return new Promise((resolve, reject) => {
    DB.run(
      "UPDATE tests SET startTimestamp = ? WHERE status = ?",
      [dayjs().valueOf(), "ONGOING"],
      function (err) {
        if (err) reject(err);

        DB.all(Q_GET_ONGOING_PARTICIPANTS, function (err, rows) {
          if (err) reject(err);

          const assignDevices = Promise.all(
            rows.map((row) =>
              assignDevice(null, {
                status: "START",
                devId: row.devId,
                participantId: row.participant_id,
                testParticipantId: row.id,
                code: row.code,
              })
            )
          );

          assignDevices.then((_) => {
            // clear
            GPS_LOG.remove().write();

            if (MODE == 2 || MODE == 3) {
              // TODO: Jam masih nambah ketika udah finish
              startCountup();
            } else {
              startCountdown();
            }
            resolve(true);
          });
        });
      }
    );
  });
}

async function finishTest() {
  if (currentTimer !== null) {
    currentTimer.unsubscribe();
    currentTimer = null;
  }

  if (currentTimer2 !== null) {
    currentTimer2.unsubscribe();
    currentTimer2 = null;
  }

  try {
    const test = await DB.pGet(
      squel.select().from("tests").where("status = ?", "ONGOING").toString()
    );

    DB.pRun(
      squel
        .update()
        .table("tests")
        .set("finishTimestamp", dayjs().valueOf())
        .where("id = ?", test.id)
        .toString()
    );

    const participants = await DB.pAll(Q_GET_ONGOING_PARTICIPANTS);

    Promise.all(
      participants.map((p) => {
        const current = GPS_LOG.find({
          id: p.devId,
        });

        const distance = getPathLength(current.get("data").value());

        const score = String(
          getScore(
            test.mode,
            p.gender,
            distance,
            ongoingTimer,
            getAge(p.birthDate)
          )
        );

        //Added By Andri 11 Sept 2020
        console.log("OnGoing Timer : ", ongoingTimer);

        //

        if (MODE == 1) {
          return DB.pRun(
            squel
              .update()
              .table("test_participants")
              .setFields({
                distance: distance,
                time: ongoingTimer,
                finished: 1,
                score: score,
              })
              .where("id = ?", p.id)
              .toString()
          );
        }
      })
    );

    participants.map((row) => {
      assignDevice(null, {
        status: "FINISH",
        devId: row.devId,
        participantId: row.participant_id,
        testParticipantId: row.id,
        code: row.code,
      });

      PUBSUB.publish(FINISH_STATUS, {
        [FINISH_STATUS]: [
          {
            id: row.device_id,
            isFinished: true,
          },
        ],
      });
    });

    return true;
  } catch (error) {
    return error;
  }
}

function endTest() {
  return new Promise((resolve, reject) => {
    DB.all(Q_GET_ONGOING_PARTICIPANTS, function (err, rows) {
      if (err) reject(err);

      DB.run(
        "UPDATE tests SET status = ? WHERE status = ?",
        ["ENDED", "ONGOING"],
        function (err) {
          if (err) reject(err);

          rows.map((r) => client.publish(`cf/${r.devId}`, `READY,${r.code}`));
        }
      );

      STORE.setState({
        online: [],
        onbody: [],
        gps: [],
        gps_log: [],
        ongoingTest: null,
      }).write();

      resolve(true);
    });
  });
}

function getDeviceId(devId) {
  return new Promise((resolve, reject) => {
    if (idMappings.has(devId)) {
      resolve(idMappings.get(devId));
    } else {
      DB.get(
        "SELECT * FROM devices WHERE devId = ?",
        [devId],
        function (err, row) {
          if (err) reject(err);

          if (row) {
            idMappings.set(devId, row.id);

            resolve(row.id);
          } else {
            resolve(null);
          }
        }
      );
    }
  });
}

function deleteTest(_, { id = null }) {
  return new Promise((resolve, reject) => {
    if (id !== null) {
      DB.run("DELETE from tests WHERE id = ?", [Number(id)], function (err) {
        if (err) reject(err);

        resolve(true);
      });
    } else {
      DB.run("DELETE from tests", function (err) {
        if (err) reject(err);

        resolve(true);
      });
    }
  });
}

function getOngingTest() {
  return new Promise((resolve, reject) => {
    DB.get(
      "SELECT * FROM tests WHERE status = ?",
      ["ONGOING"],
      function (err, row) {
        if (err) reject(err);

        resolve(row);
      }
    );
  });
}

async function getOngoingTestParticipants() {
  const test = await getOngingTest();

  return await new Promise((resolve, reject) => {
    DB.all(
      `
            SELECT tp.id as testParticipantId, * 
            FROM test_participants tp
            JOIN participants p ON p.id = tp.participant_id
            JOIN devices d ON d.id = tp.device_id   
            WHERE test_id = ? AND canceled = 0`,
      [test.id],
      function (err, rows) {
        if (err) reject(err);

        resolve(
          rows.map((x) => ({
            id: x.device_id,
            testParticipantId: x.testParticipantId,
            fullname: x.fullname,
            age: getAge(x.birthDate),
            number: x.participant_number,
            code: x.code,
            isWeared: false,
            isOnline: STORE.some((y) => y == x.devId).value(),
            isGpsReady: ST_GPS.some((y) => y == x.devId).value(),
            isFinished: x.finished,
            battery: null,
            heartRate: null,
            distance: x.distance,
            heartRateThreshold: getHeartRateThreshold(x.birthDate),
            WAKTOS: x.time,
            lastlat: x.lastlat,
            lastlon: x.lastlon
          }))
        );
      }
    );
  });
}

function assignDevice(
  _,
  { status, devId, participantId, testParticipantId = null, code = null }
) {
  return new Promise((resolve, reject) => {
    DB.get(
      "SELECT * FROM participants WHERE id=?",
      [Number(participantId)],
      (err, result) => {
        if (err) reject(err);

        const hrThreshold = getHeartRateThreshold(result.birthDate);

        const msg = [
          status,
          result.id,
          result.fullname,
          hrThreshold,
          testParticipantId,
          code,
          result.NRP,
        ].join(",");
        client.publish(`cf/${devId}`, msg);
      }
    );

    resolve(true);
  });
}

function addCategory(_, { category }) {
  return new Promise((resolve, reject) => {
    DB.run(
      "INSERT INTO test_category(category) VALUES(?)",
      [category],
      (err, result) => {
        if (err) reject(err);

        resolve(true);
      }
    );
  });
}

function sendCommandToDevices(_, { cmd }) {
  client.publish("cmd", cmd, {
    qos: 0,
    retain: true,
  });

  return true;
}

function testTimer() {
  startCountdown();

  return true;
}

function startCountdown() {
  if (currentTimer !== null) {
    currentTimer.unsubscribe();
    currentTimer2.unsubscribe();

    currentTimer = null;
    currentTimer2 = null;
    return;
  }

  const times = COUNDOWN_TIME;

  const countdown = interval(1000).pipe(take(times));

  currentTimer = countdown
    .pipe(
      tap((d) => (ongoingTimer = d)),
      map((v) => toHHMMSS(times - (v + 1)))
    )
    .subscribe((timer) => {
      client.publish("timer", timer, {
        qos: 0,
      });

      PUBSUB.publish(ONGOING_TIMER, {
        [ONGOING_TIMER]: {
          id: "1",
          timer,
        },
      });
    });

  currentTimer2 = countdown.pipe(filter((v) => v + 1 == times)).subscribe({
    complete() {
      // end test
      finishTest();
    },
  });
}

function startCountup() {
  if (currentTimer !== null) {
    currentTimer.unsubscribe();

    currentTimer = null;
    return;
  }

  if (currentTimer2 !== null) {
    currentTimer2.unsubscribe();

    currentTimer2 = null;
    return;
  }

  const countdown = interval(1000);

  currentTimer = countdown
    .pipe(
      tap((v) => (ongoingTimer = v)),
      map((v) => toHHMMSS(v + 1))
    )
    .subscribe((timer) => {
      client.publish("timer", timer, {
        qos: 0,
      });

      PUBSUB.publish(ONGOING_TIMER, {
        [ONGOING_TIMER]: {
          id: "1",
          timer,
        },
      });
    });
}

async function getDashboardData() {
  return {
    totalTest: await getTotalTest(),
    endedTest: await getEndedTest(),
    totalParticipants: await getTotalRegisteredParticipant(),
    avgHeartRate: await getAvgHeartRate(),
    peakMileage: await getPeakMileage(),
  };
}

async function getChartData(_, { mode, start, end }) {
  const date = (f) => `date(datetime(${f} / 1000, 'unixepoch', 'localtime'))`;

  const baseQuery = squel
    .select()
    .from("test_participants", "tp")
    .join("participants", "p", "tp.participant_id = p.id")
    .join("pangkat", "pkt", "p.id_pangkat = pkt.id")
    .join("satuan", "sat", "pkt.id_satuan = sat.id");

  const qScoreCount = baseQuery.clone();

  if (mode == 2) {
    qScoreCount
      .field(
        "SUM(CASE WHEN score = 'Sangat Kurang' THEN 1 ELSE 0 END)",
        "Sangat Kurang"
      )
      .field("SUM(CASE WHEN score = 'Kurang' THEN 1 ELSE 0 END)", "Kurang")
      .field("SUM(CASE WHEN score = 'Sedang' THEN 1 ELSE 0 END)", "Sedang")
      .field("SUM(CASE WHEN score = 'Baik' THEN 1 ELSE 0 END)", "Baik")
      .field(
        "SUM(CASE WHEN score = 'Baik Sekali' THEN 1 ELSE 0 END)",
        "Baik Sekali"
      )
      .field(
        "SUM(CASE WHEN score = 'Baik Sekali dan Terlatih' THEN 1 ELSE 0 END)",
        "Baik Sekali dan Terlatih"
      );
  } else {
    qScoreCount
      .field(
        "SUM(CASE WHEN score >= 67 AND score  < 70 THEN 1 ELSE 0 END)",
        "67-69"
      )
      .field(
        "SUM(CASE WHEN score >= 70 AND score  < 80 THEN 1 ELSE 0 END)",
        "70-79"
      )
      .field(
        "SUM(CASE WHEN score >= 80 AND score  < 90 THEN 1 ELSE 0 END)",
        "80-89"
      )
      .field("SUM(CASE WHEN score >= 90 THEN 1 ELSE 0 END)", "90-100");
  }

  const qSummaryByParticipant = baseQuery
    .clone()
    .group("p.id")
    .fields([
      "p.id",
      "sat.satuan",
      "pkt.pangkat",
      "p.kesatuan",
      "p.fullname",
      "ROUND(AVG(tp.score)) as avg_score",
    ])
    .field(
      squel
        .select()
        .field("ROUND(AVG(hrl.hr_value))")
        .from("heart_rate_logs", "hrl")
        .where("hrl.test_participant_id = tp.id"),
      "avg_hr"
    );

  const qScoreCountBySatuan = qScoreCount
    .clone()
    .field("sat.satuan", "satuan")
    .group("sat.satuan");

  const qEndedTests = baseQuery
    .clone()
    .group("sat.id")
    .fields(["sat.id", "sat.satuan", "COUNT(p.id) as jml"]);

  const qTestByGender = baseQuery
    .clone()
    .group("p.gender")
    .fields(["p.id", "p.gender", "COUNT(p.id) as jml"]);

  try {
    const joinExpr = squel
      .expr()
      .and("tp.test_id = t.id")
      .and('t.status = "ENDED"');

    if (mode) {
      joinExpr.and("t.mode = ?", mode);
    }

    if (start && end) {
      joinExpr.and(
        `${date("t.startTimestamp")} BETWEEN date(?) AND date(?)`,
        start,
        end
      );
    } else {
      const qLastTestDate = squel
        .select()
        .field(`${date("t.startTimestamp")}`, "startDate")
        .from("tests", "t")
        .where("t.status = 'ENDED'")
        .order("t.startTimestamp", false)
        .limit(1);
      const lastTest = await DB.pGet(qLastTestDate.toString());
      joinExpr.and(`${date("t.startTimestamp")} = ?`, lastTest.startDate);
    }

    qEndedTests.join("tests", "t", joinExpr);
    qTestByGender.join("tests", "t", joinExpr);
    qScoreCount.join("tests", "t", joinExpr);
    qScoreCountBySatuan.join("tests", "t", joinExpr);
    qSummaryByParticipant.join("tests", "t", joinExpr);

    const dataByParticipant = await DB.pAll(qSummaryByParticipant.toString());
    const chartBySatuan = await DB.pAll(qEndedTests.toString());
    const chartByGender = await DB.pAll(qTestByGender.toString());
    const chartByScore = await DB.pGet(qScoreCount.toString());
    const chartBySatuanScore = await DB.pAll(qScoreCountBySatuan.toString());

    const backgroundColor = [
      "#aed581",
      "#81c784",
      "#4db6ac",
      "#4dd0e1",
      "#4fc3f7",
      "#64b5f6",
      "#7986cb",
      "#9575cd",
      "#ba68c8",
      "#f06292",
      "#e57373",
    ];

    return {
      dataByParticipant: dataByParticipant,
      chartBySatuan: {
        labels: chartBySatuan.map((x) => x.satuan),
        datasets: [
          {
            data: chartBySatuan.map((x) => x.jml),
            backgroundColor,
          },
        ],
      },
      chartByGender: {
        labels: chartByGender.map((x) =>
          x.gender == "MALE" ? "Laki-Laki" : "Perempuan"
        ),
        datasets: [
          {
            data: chartByGender.map((x) => x.jml),
            backgroundColor,
          },
        ],
      },
      chartByScore: {
        labels: Object.keys(chartByScore),
        datasets: [
          {
            data: Object.values(chartByScore),
            backgroundColor,
          },
        ],
      },
      chartBySatuanScore: {
        labels: chartBySatuanScore.map((x) => x.satuan),
        datasets:
          mode == 2
            ? [
                {
                  label: "Sangat Kurang",
                  backgroundColor: ["#aed581"],
                  data: chartBySatuanScore.map((x) => x["Sangat Kurang"]),
                },
                {
                  label: "Kurang",
                  backgroundColor: ["#81c784"],
                  data: chartBySatuanScore.map((x) => x["Kurang"]),
                },
                {
                  label: "Sedang",
                  backgroundColor: ["#4db6ac"],
                  data: chartBySatuanScore.map((x) => x["Sedang"]),
                },
                {
                  label: "Baik",
                  backgroundColor: ["#4dd0e1"],
                  data: chartBySatuanScore.map((x) => x["Baik"]),
                },
                {
                  label: "Baik Sekali dan Terlatih",
                  backgroundColor: ["#4fc3f7"],
                  data: chartBySatuanScore.map(
                    (x) => x["Baik Sekali dan Terlatih"]
                  ),
                },
              ]
            : [
                {
                  label: "67-69",
                  backgroundColor: ["#f87979"],
                  data: chartBySatuanScore.map((x) => x["67-69"]),
                },
                {
                  label: "70-79",
                  backgroundColor: ["#3D5B96"],
                  data: chartBySatuanScore.map((x) => x["70-79"]),
                },
                {
                  label: "80-89",
                  backgroundColor: ["#1EFFFF"],
                  data: chartBySatuanScore.map((x) => x["80-89"]),
                },
                {
                  label: "90-100",
                  backgroundColor: ["red"],
                  data: chartBySatuanScore.map((x) => x["90-100"]),
                },
              ],
      },
    };
  } catch (error) {
    console.log(error);
  }
}

async function getLastFinishedTest() {
  const QUERY = squel
    .select()
    .from("tests")
    .where("status = 'ENDED'")
    .order("finishTimestamp", false)
    .limit(1)
    .toString();

  return DB.pGet(QUERY);
}

async function getTestParticipantResults(_, { id = null }) {
  const QUERY =
    id == null
      ? "SELECT id, mode FROM tests WHERE status='ENDED' ORDER BY finishTimestamp DESC LIMIT 1"
      : "SELECT id, mode FROM tests WHERE status='ENDED' AND id = ?";
  const PARAMS = id == null ? [] : [id];
  try {
    const test = await new Promise((resolve, reject) => {
      DB.get(QUERY, PARAMS, function (err, row) {
        if (err) reject(reject(err));

        resolve(row);
      });
    });

    if (test) {
      const QUERY = `
            SELECT 
                tp.* ,
                p.fullname,
                p.birthDate,
                p.gender,
                d.code,
                CAST(ROUND(AVG(hrl.hr_value)) AS INT) as avg_hr,
                MAX(hrl.hr_value) as max_hr
            FROM test_participants tp 
            LEFT JOIN heart_rate_logs hrl ON hrl.test_participant_id = tp.id
            LEFT JOIN gps_logs gl ON gl.test_participant_id = tp.id
            LEFT JOIN participants p ON tp.participant_id = p.id
            LEFT JOIN devices d ON tp.device_id = d.id
            WHERE test_id = ?
            GROUP BY tp.id
        `;

      const testParticipants = await new Promise((resolve, reject) => {
        DB.all(QUERY, [test.id], function (err, rows) {
          if (err) reject(err);

          resolve(rows);
        });
      });

      return testParticipants.map((p) => ({
        fullname: p.fullname,
        number: p.participant_number,
        deviceName: p.code,
        age: getAge(p.birthDate),
        threshold: getHeartRateThreshold(p.birthDate),
        avgHeartRate: p.avg_hr,
        peakHeartRate: p.max_hr,
        mileage: p.distance,
        duration: p.time == null ? "-" : toHHMMSS(p.time),
        participantId: p.participant_id,
        score: String(
          getScore(test.mode, p.gender, p.distance, p.time, getAge(p.birthDate))
        ), // todo: age based on startTimestamp test
      }));
    } else {
      return null;
    }
  } catch (error) {
    console.error(error);
  }
}

function getScore2400(gender, age, time) {
  const timeInMinutes = time / 60;

  switch (gender) {
    case "MALE":
      switch (true) {
        case age >= 13 && age <= 19:
          switch (true) {
            case timeInMinutes > 15.31:
              return "Sangat Kurang";
            case timeInMinutes >= 12.11 && timeInMinutes <= 15.3:
              return "Kurang";
            case timeInMinutes >= 10.49 && timeInMinutes <= 12.1:
              return "Sedang";
            case timeInMinutes >= 9.41 && timeInMinutes <= 9.48:
              return "Baik";
            case timeInMinutes >= 8.37 && timeInMinutes <= 9.4:
              return "Baik Sekali";
            case timeInMinutes < 8.37:
              return "Baik Sekali dan Terlatih";
          }
          break;
        case age >= 20 && age <= 29:
          switch (true) {
            case timeInMinutes > 16.01:
              return "Sangat Kurang";
            case timeInMinutes >= 14.01 && timeInMinutes <= 16.0:
              return "Kurang";
            case timeInMinutes >= 12.01 && timeInMinutes <= 14.0:
              return "Sedang";
            case timeInMinutes >= 10.46 && timeInMinutes <= 12.0:
              return "Baik";
            case timeInMinutes >= 9.45 && timeInMinutes <= 10.45:
              return "Baik Sekali";
            case timeInMinutes < 9.45:
              return "Baik Sekali dan Terlatih";
          }
          break;
        case age >= 30 && age <= 39:
          switch (true) {
            case timeInMinutes > 16.31:
              return "Sangat Kurang";
            case timeInMinutes >= 14.46 && timeInMinutes <= 16.3:
              return "Kurang";
            case timeInMinutes >= 12.31 && timeInMinutes <= 14.45:
              return "Sedang";
            case timeInMinutes >= 11.01 && timeInMinutes <= 12.3:
              return "Baik";
            case timeInMinutes >= 10.0 && timeInMinutes <= 11.0:
              return "Baik Sekali";
            case timeInMinutes < 10.0:
              return "Baik Sekali dan Terlatih";
          }
          break;
        case age >= 40 && age <= 49:
          switch (true) {
            case timeInMinutes > 17.31:
              return "Sangat Kurang";
            case timeInMinutes >= 15.36 && timeInMinutes <= 17.3:
              return "Kurang";
            case timeInMinutes >= 13.01 && timeInMinutes <= 15.35:
              return "Sedang";
            case timeInMinutes >= 11.31 && timeInMinutes <= 13.0:
              return "Baik";
            case timeInMinutes >= 10.3 && timeInMinutes <= 11.3:
              return "Baik Sekali";
            case timeInMinutes < 10.3:
              return "Baik Sekali dan Terlatih";
          }
          break;
        case age >= 50 && age <= 59:
          switch (true) {
            case timeInMinutes > 19.01:
              return "Sangat Kurang";
            case timeInMinutes >= 17.01 && timeInMinutes <= 19.0:
              return "Kurang";
            case timeInMinutes >= 14.31 && timeInMinutes <= 17.0:
              return "Sedang";
            case timeInMinutes >= 12.31 && timeInMinutes <= 14.3:
              return "Baik";
            case timeInMinutes >= 11.0 && timeInMinutes <= 12.3:
              return "Baik Sekali";
            case timeInMinutes < 11.0:
              return "Baik Sekali dan Terlatih";
          }
          break;
        case age >= 60:
          switch (true) {
            case timeInMinutes > 20.0:
              return "Sangat Kurang";
            case timeInMinutes >= 19.01 && timeInMinutes <= 20.0:
              return "Kurang";
            case timeInMinutes >= 16.16 && timeInMinutes <= 19.0:
              return "Sedang";
            case timeInMinutes >= 14.15 && timeInMinutes <= 16.15:
              return "Baik";
            case timeInMinutes >= 11.15 && timeInMinutes <= 13.59:
              return "Baik Sekali";
            case timeInMinutes < 11.15:
              return "Baik Sekali dan Terlatih";
          }
          break;
      }
    case "FEMALE":
      switch (true) {
        case age >= 13 && age <= 19:
          switch (true) {
            case timeInMinutes > 18.31:
              return "Sangat Kurang";
            case timeInMinutes >= 16.55 && timeInMinutes <= 18.3:
              return "Kurang";
            case timeInMinutes >= 14.31 && timeInMinutes <= 16.54:
              return "Sedang";
            case timeInMinutes >= 12.3 && timeInMinutes <= 14.3:
              return "Baik";
            case timeInMinutes >= 11.5 && timeInMinutes <= 12.29:
              return "Baik Sekali";
            case timeInMinutes < 11.5:
              return "Baik Sekali dan Terlatih";
          }
          break;
        case age >= 20 && age <= 29:
          switch (true) {
            case timeInMinutes > 19.01:
              return "Sangat Kurang";
            case timeInMinutes >= 18.31 && timeInMinutes <= 19.0:
              return "Kurang";
            case timeInMinutes >= 15.55 && timeInMinutes <= 18.3:
              return "Sedang";
            case timeInMinutes >= 13.31 && timeInMinutes <= 15.54:
              return "Baik";
            case timeInMinutes >= 12.3 && timeInMinutes <= 13.3:
              return "Baik Sekali";
            case timeInMinutes < 12.3:
              return "Baik Sekali dan Terlatih";
          }
          break;
        case age >= 30 && age <= 39:
          switch (true) {
            case timeInMinutes > 19.31:
              return "Sangat Kurang";
            case timeInMinutes >= 19.01 && timeInMinutes <= 19.3:
              return "Kurang";
            case timeInMinutes >= 16.31 && timeInMinutes <= 19.0:
              return "Sedang";
            case timeInMinutes >= 14.31 && timeInMinutes <= 16.0:
              return "Baik";
            case timeInMinutes >= 13.0 && timeInMinutes <= 14.3:
              return "Baik Sekali";
            case timeInMinutes < 13.0:
              return "Baik Sekali dan Terlatih";
          }
          break;
        case age >= 40 && age <= 49:
          switch (true) {
            case timeInMinutes > 20.01:
              return "Sangat Kurang";
            case timeInMinutes >= 19.31 && timeInMinutes <= 20.0:
              return "Kurang";
            case timeInMinutes >= 17.31 && timeInMinutes <= 19.3:
              return "Sedang";
            case timeInMinutes >= 15.57 && timeInMinutes <= 17.3:
              return "Baik";
            case timeInMinutes >= 13.45 && timeInMinutes <= 15.56:
              return "Baik Sekali";
            case timeInMinutes < 13.45:
              return "Baik Sekali dan Terlatih";
          }
          break;
        case age >= 50 && age <= 59:
          switch (true) {
            case timeInMinutes > 20.31:
              return "Sangat Kurang";
            case timeInMinutes >= 20.01 && timeInMinutes <= 19.0:
              return "Kurang";
            case timeInMinutes >= 19.01 && timeInMinutes <= 20.0:
              return "Sedang";
            case timeInMinutes >= 16.31 && timeInMinutes <= 19.0:
              return "Baik";
            case timeInMinutes >= 14.3 && timeInMinutes <= 16.3:
              return "Baik Sekali";
            case timeInMinutes < 14.3:
              return "Baik Sekali dan Terlatih";
          }
          break;
        case age >= 60:
          switch (true) {
            case timeInMinutes > 21.01:
              return "Sangat Kurang";
            case timeInMinutes >= 20.31 && timeInMinutes <= 21.0:
              return "Kurang";
            case timeInMinutes >= 19.31 && timeInMinutes <= 20.3:
              return "Sedang";
            case timeInMinutes >= 17.31 && timeInMinutes <= 19.3:
              return "Baik";
            case timeInMinutes >= 16.3 && timeInMinutes <= 17.3:
              return "Baik Sekali";
            case timeInMinutes < 16.3:
              return "Baik Sekali dan Terlatih";
          }
          break;
      }
  }
}

function getScore(mode, gender, distance, time = null, age = null) {
  const map = new Map([
    [
      1,
      new Map([
        [
          "MALE",
          distance >= 3444
            ? 100
            : 67 + (distance >= 2745 ? Math.floor((distance - 2745) / 21) : 0),
        ],
        [
          "FEMALE",
          distance >= 3095
            ? 100
            : 67 + (distance >= 2407 ? Math.floor((distance - 2407) / 21) : 0),
        ],
      ]),
    ],
    [
      2,
      new Map([
        ["MALE", getScore2400(gender, age, time)],
        ["FEMALE", getScore2400(gender, age, time)],
      ]),
    ],
    [
      3,
      new Map([
        [
          "MALE",
          Math.floor(
            100 -
              Math.floor(
                Math.abs(
                  Math.min(
                    0,
                    657 + Math.abs(Math.ceil((18 - age) / 4) * 20) - time
                  )
                ) / 4
              )
          ),
        ],
        [
          "FEMALE",
          Math.floor(
            100 -
              Math.floor(
                Math.abs(
                  Math.min(
                    0,
                    795 + Math.abs(Math.ceil((18 - age) / 6) * 30) - time
                  )
                ) / 4
              )
          ),
        ],
      ]),
    ],
  ]);

  return map.get(mode).get(gender);
}

function getTotalTest() {
  return new Promise((resolve, reject) => {
    DB.get("SELECT COUNT(*) as totalTest FROM tests", function (err, row) {
      if (err) reject(err);

      resolve(row.totalTest);
    });
  });
}

function getEndedTest() {
  return new Promise((resolve, reject) => {
    DB.get(
      "SELECT COUNT(*) as totalTest FROM tests WHERE status=?",
      ["ENDED"],
      function (err, row) {
        if (err) reject(err);

        resolve(row.totalTest);
      }
    );
  });
}

function getAvgHeartRate() {
  return new Promise((resolve, reject) => {
    DB.get(
      "SELECT AVG(hr_value) as avg_hr FROM heart_rate_logs",
      function (err, row) {
        if (err) reject(err);

        resolve(Math.trunc(row.avg_hr));
      }
    );
  });
}

function getTotalRegisteredParticipant() {
  return new Promise((resolve, reject) => {
    DB.get(
      "SELECT COUNT(*) as totalParticipants FROM participants",
      function (err, row) {
        if (err) reject(err);

        resolve(row.totalParticipants);
      }
    );
  });
}

function getPeakMileage() {
  return new Promise((resolve, reject) => {
    DB.get(
      "SELECT max(distanceTotal) as peakMileage FROM gps_logs",
      function (err, row) {
        if (err) reject(err);

        resolve(row.peakMileage);
      }
    );
  });
}

async function getHeartRateSeries(_, { id = null, testParticipantId = null }) {
  const QUERY = `
        WITH RECURSIVE
            cnt(x) AS (
            SELECT 0
            UNION ALL
            SELECT x+1 FROM cnt
                LIMIT CAST(ABS((julianday($start/1000, 'UNIXEPOCH') - julianday($finish/1000, 'UNIXEPOCH')) * 24 * 60 * 60) / 5 AS INTEGER)
            )
        SELECT 
            time((x+1)*5, 'UNIXEPOCH') as sec,
            CAST(ROUND(AVG(hrl.hr_value)) AS INTEGER) AS heart_rate
        FROM cnt
        LEFT JOIN heart_rate_logs hrl 
        ON (datetime(hrl.timestamp, 'UNIXEPOCH') >= datetime($start/1000, 'UNIXEPOCH', '+' || (x*5) || ' SECONDS') 
        AND datetime(hrl.timestamp, 'UNIXEPOCH') < datetime($start/1000, 'UNIXEPOCH', '+' || ((x+1)*5) || ' SECONDS'))
        AND test_participant_id = $id
        GROUP BY sec
    `;
  try {
    const test = await new Promise((resolve, reject) => {
      if (id == null && testParticipantId == null) {
        DB.get(
          "SELECT * FROM tests WHERE status='ENDED' ORDER BY finishTimestamp DESC LIMIT 1",
          function (err, row) {
            if (err) reject(err);

            resolve(row);
          }
        );
      } else {
        DB.get(
          "SELECT * FROM tests WHERE status='ENDED' AND id = ?",
          [id],
          function (err, row) {
            if (err) reject(err);

            resolve(row);
          }
        );
      }
    });

    const testParticipants = await new Promise(function (resolve, reject) {
      if (testParticipantId == null) {
        const QUERY = `
                    SELECT tp.id, p.fullname FROM test_participants tp
                    JOIN participants p ON p.id = tp.participant_id
                    WHERE test_id = ?
                `;
        DB.all(QUERY, [test.id], function (err, rows) {
          if (err) reject(err);
          resolve(rows);
        });
      } else {
        const QUERY = `
                    SELECT tp.id, p.fullname FROM test_participants tp
                    JOIN participants p ON p.id = tp.participant_id
                    WHERE tp.id = ?
                `;
        DB.all(QUERY, [testParticipantId], function (err, rows) {
          if (err) reject(err);
          resolve(rows);
        });
      }
    });

    const heartRateData = await Promise.all(
      testParticipants.map(
        (tp) =>
          new Promise((resolve, reject) => {
            DB.all(
              QUERY,
              {
                $start: test.startTimestamp,
                $finish: test.finishTimestamp,
                $id: tp.id,
              },
              function (err, rows) {
                if (err) reject(err);

                resolve({
                  fullname: tp.fullname,
                  data: rows,
                });
              }
            );
          })
      )
    );

    if (heartRateData.length) {
      const labels = heartRateData[0].data.map((x) => x.sec.substr(3, 5));

      return {
        labels,
        data: heartRateData.map((hr) =>
          Object.assign(hr, {
            data: hr.data.reduce(
              (acc, cur) => {
                if (cur.heart_rate != null) {
                  acc.last = cur.heart_rate;
                }

                if (acc.data == null) {
                  acc.data = [cur.heart_rate];
                } else {
                  if (cur.heart_rate == null) {
                    acc.data.push(acc.last);
                  } else {
                    acc.data.push(cur.heart_rate);
                  }
                }

                return acc;
              },
              {
                last: null,
                data: [],
              }
            ).data,
          })
        ),
      };
    }

    return null;
  } catch (error) {
    console.error(error);
  }
}

async function getParticipantTests(_, { id }) {
  const participant = await dbGet("SELECT * FROM participants WHERE id = ?", [
    id,
  ]);

  const QUERY = `
        SELECT 
            tp.id, 
            tp.distance,
            tp.time,
            t.id as testId,
            t.eventName as testName, 
            t.timeScheduled as testDate,
            t.mode,
            d.code as deviceName,
            CAST(ROUND(AVG(hrl.hr_value)) AS INT) as avgHeartRate,
            MAX(hrl.hr_value) as peakHeartRate
        FROM test_participants tp
        LEFT JOIN tests t ON tp.test_id = t.id
        LEFT JOIN devices d ON tp.device_id = d.id
        LEFT JOIN heart_rate_logs hrl ON hrl.test_participant_id = tp.id
        WHERE tp.participant_id = ?
        GROUP BY tp.id
    `;

  const tps = await dbAll(QUERY, [participant.id]);

  const result = tps.map((d) => ({
    ...d,
    testDate: dayjs(d.testDate).format("YYYY-MM-DD HH:mm"),
    age: getAge(participant.birthDate),
    threshold: getHeartRateThreshold(participant.birthDate),
    duration: d.time == null ? "-" : toHHMMSS(d.time),
    mileage: d.distance,
    score: String(
      getScore(
        d.mode,
        participant.gender,
        d.distance,
        d.time,
        getAge(participant.birthDate)
      )
    ),
  }));

  return result;
}

function getSatuan() {
  return new Promise((resolve, reject) => {
    DB.all("SELECT * FROM satuan", function (err, rows) {
      if (err) reject(err);

      resolve(rows);
    });
  });
}

function getPangkat(_, { satuan }) {
  return new Promise((resolve, reject) => {
    DB.all(
      "SELECT * FROM pangkat WHERE id_satuan = ?",
      [satuan],
      function (err, rows) {
        if (err) reject(err);

        resolve(rows);
      }
    );
  });
}

function getCategories() {
  return new Promise((resolve, reject) => {
    DB.all("SELECT * FROM test_category", (err, rows) => {
      if (err) reject(err);

      resolve(rows);
    });
  });
}

function getCategory(_, { id }) {
  return new Promise((resolve, reject) => {
    DB.get("SELECT * FROM test_category WHERE id = ?", [id], (err, row) => {
      if (err) reject(err);

      resolve(row);
    });
  });
}

function deleteCategory(_, { id }) {
  return new Promise((resolve, reject) => {
    DB.run("DELETE FROM test_category WHERE id = ?", [id], (err) => {
      if (err) reject(err);

      resolve(true);
    });
  });
}

function updateCategory(_, { id, category }) {
  return new Promise((resolve, reject) => {
    DB.run(
      "UPDATE test_category SET category = ? WHERE id = ?",
      [category, id],
      (err) => {
        if (err) reject(err);

        resolve(true);
      }
    );
  });
}

function dbGet(query, params = null) {
  return new Promise((resolve, reject) => {
    DB.get(query, params, function (err, row) {
      if (err) reject(err);

      resolve(row);
    });
  });
}

function dbAll(query, params = null) {
  return new Promise((resolve, reject) => {
    DB.all(query, params, function (err, rows) {
      if (err) reject(err);

      resolve(rows);
    });
  });
}

function toHHMMSS(s) {
  var sec_num = parseInt(s, 10); // don't forget the second param
  var hours = Math.floor(sec_num / 3600);
  var minutes = Math.floor((sec_num - hours * 3600) / 60);
  var seconds = sec_num - hours * 3600 - minutes * 60;

  return (
    String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0")
  );
}

function getAge(birthDate) {
  return dayjs().diff(dayjs(birthDate), "year");
}

function getHeartRateThreshold(birthDate) {
  return 220 - getAge(birthDate);
}

function onServerListening({ url }) {
  console.log(`🚀  Server ready at ${url}`);
}
