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
const { Agent } = require("https");

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

const DB_SCHEMA = [
  `PRAGMA foreign_keys = ON`,
  `CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        devId TEXT UNIQUE,
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
        distance REAL DEFAULT 0,
        canceled INTEGER DEFAULT 0,
        time TEXT,
        finished INTEGER,
        score INTEGER,
        lastlat REAL,
        lastlon REAL,
        lastreader INTEGER DEFAULT 0,
        temp_distance REAL DEFAULT 0,
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
        readerId INTEGER UNIQUE,
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
    peakMileage: Float
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
    mileage: Float
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
    deviceChipId: ID
    fullname: String
    code: String
    codeChip: String
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
    cenlaplon: Float
    cenlaplat: Float
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
    temp_distance: Float
  }

  type TestParticipantResult {
    fullname: String
    number: String
    deviceName: String
    age: Int
    threshold: Int
    avgHeartRate: Int
    peakHeartRate: Int
    mileage: Float
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
    addParticipant(participants: [ParticipantInput]): ID
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

client.setMaxListeners(100);

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

      const temp_distance = getPathLength(current.get("data").value());

      return {
        devId: String(deviceId),
        testParticipantId: testParticipantId ? Number(testParticipantId) : null,
        gps: {
          ...point,
          accuracy: parseFloat(accuracy),
          distance: '',
          lastDistance: '',
          temp_distance,
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
            gps.temp_distance,
            gps.lastDistance,
          ],
          function (err) {
            if (err) {
              console.log(err);
            }
          }
        );

        DB.run(
          "UPDATE test_participants SET lastlat = ?, lastlon = ?, temp_distance = ? WHERE id = ?",
          [gps.latitude, gps.longitude, gps.temp_distance, testParticipantId],
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
      console.log("");
      switch (pointReader) {
        case 1:
          let ke1 = 0.0;

          // Use a promise to wrap the database operation
          const updateDistancePromise1 = new Promise((resolve, reject) => {
            DB.all(
              "SELECT distance, lastreader FROM test_participants WHERE id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
              [testParticipantId, chipId],
              (error, rows) => {
                if (error) {
                  console.error("Error updating distance:", error);
                  reject(error);
                } else {
                  let distances1 = rows.map(row => row.distance);
                  let lastreader1 = rows.map(row => row.lastreader);
                  console.log("LAST READER: ",lastreader1)
                  if (lastreader1 == 4) {
                    ke1 = parseFloat(distances1) + 115.61;
                    console.log("hasil akhir", ke1);
                  } else if(lastreader1 == 3) {
                    ke1 = parseFloat(distances1) + 200;
                    console.log("hasil akhir", ke1);
                  } else if(lastreader1 == 2) {
                    ke1 = parseFloat(distances1) + 315.61;
                    console.log("hasil akhir", ke1);
                  } else if(lastreader1 == 0) {
                    ke1 = parseFloat(distances1) + 315.61;
                    console.log("hasil akhir", ke1);
                  } else {
                    ke1 = parseFloat(distances1) + 400;
                    console.log("hasil akhir", ke1);
                  }

                  // Resolve the promise with the updated distance value
                  resolve(ke1);
                }
              }
            );
          });

          // Wait for the promise to resolve before executing the update
          updateDistancePromise1.then(updatedDistance1 => {
            // Update test_participants table
            DB.run(
              "UPDATE test_participants SET distance = ?, temp_distance = ? WHERE id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
              [updatedDistance1, 0, testParticipantId, chipId],
              (error) => {
                if (error) {
                  console.error("Error updating distance:", error);
                } else {
                  console.log("Distance updated successfully");
                  console.log(updatedDistance1);
          
                  // Add the query to retrieve devId
                  DB.get(
                    "SELECT devId FROM devices WHERE id = (SELECT device_id FROM test_participants WHERE id = ?)",
                    [testParticipantId],
                    (error, result) => {
                      if (error) {
                        console.error("Error retrieving devId:", error);
                      } else {
                        // Check if devId is found
                        if (result && result.devId) {
                          const devId = result.devId;
          
                          // Find GPS_LOG with id and remove its entry
                          const gpsLogEntryIndex = GPS_LOG.findIndex({ id: devId });
                          if (gpsLogEntryIndex !== -1) {
                            GPS_LOG.remove({ id: devId }).write();
                            console.log("GPS_LOG entry removed successfully");
                          } else {
                            console.log("GPS_LOG entry not found for devId:", devId);
                          }
                        } else {
                          console.log("No devId found for the given testParticipantId:", testParticipantId);
                        }
                      }
                    }
                  );
                }
              }
            );
          });
          
          break;

        case 2:
          let ke2 = 0.0;

          // Use a promise to wrap the database operation
          const updateDistancePromise2 = new Promise((resolve, reject) => {
            DB.all(
              "SELECT distance, lastreader FROM test_participants WHERE id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
              [testParticipantId, chipId],
              (error, rows) => {
                if (error) {
                  console.error("Error updating distance:", error);
                  reject(error);
                } else {
                  let distances2 = rows.map(row => row.distance);
                  let lastreader2 = rows.map(row => row.lastreader);
                  console.log("LAST READER: ",lastreader2)
                  if (lastreader2 == 1) {
                    ke2 = parseFloat(distances2) + 84.39;
                    console.log("hasil akhir", ke2);
                  } else if(lastreader2 == 4) {
                    ke2 = parseFloat(distances2) + 200;
                    console.log("hasil akhir", ke2);
                  } else if(lastreader2 == 3) {
                    ke2 = parseFloat(distances2) + 284.39;
                    console.log("hasil akhir", ke2);
                  } else if(lastreader2 == 0){
                    ke2 = parseFloat(distances2) + 400;
                    console.log("hasil akhir", ke2);
                  } else {
                    ke2 = parseFloat(distances2) + 400;
                    console.log("hasil akhir", ke2);
                  }

                  // Resolve the promise with the updated distance value
                  resolve(ke2);
                }
              }
            );
          });

          // Wait for the promise to resolve before executing the update
          updateDistancePromise2.then(updatedDistance2 => {
            DB.run(
              "UPDATE test_participants SET distance = ?, temp_distance = ? WHERE id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
              [updatedDistance2, 0, testParticipantId, chipId],
              (error) => {
                if (error) {
                  console.error("Error updating distance:", error);
                } else {
                  console.log("Distance updated successfully");
                  console.log(updatedDistance2);
          
                  // Add the query to retrieve devId
                  DB.get(
                    "SELECT devId FROM devices WHERE id = (SELECT device_id FROM test_participants WHERE id = ?)",
                    [testParticipantId],
                    (error, result) => {
                      if (error) {
                        console.error("Error retrieving devId:", error);
                      } else {
                        // Check if devId is found
                        if (result && result.devId) {
                          const devId = result.devId;
          
                          // Find GPS_LOG with id and remove its entry
                          const gpsLogEntryIndex = GPS_LOG.findIndex({ id: devId });
                          if (gpsLogEntryIndex !== -1) {
                            GPS_LOG.remove({ id: devId }).write();
                            console.log("GPS_LOG entry removed successfully");
                          } else {
                            console.log("GPS_LOG entry not found for devId:", devId);
                          }
                        } else {
                          console.log("No devId found for the given testParticipantId:", testParticipantId);
                        }
                      }
                    }
                  );
                }
              }
            );
          });

          break;
        case 3:
          let ke3 = 0.0;

          // Use a promise to wrap the database operation
          const updateDistancePromise3 = new Promise((resolve, reject) => {
            DB.all(
              "SELECT distance, lastreader FROM test_participants WHERE id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
              [testParticipantId, chipId],
              (error, rows) => {
                if (error) {
                  console.error("Error updating distance:", error);
                  reject(error);
                } else {
                  let distances3 = rows.map(row => row.distance);
                  let lastreader3 = rows.map(row => row.lastreader);
                  console.log("LAST READER: ",lastreader3)
                  if (lastreader3 == 2) {
                    ke3 = parseFloat(distances3) + 115.61;
                    console.log("hasil akhir rumus 1", ke3);
                  } else if(lastreader3 == 1) {
                    ke3 = parseFloat(distances3) + 200;
                    console.log("hasil akhir rumus 2", ke3);
                  } else if(lastreader3 == 4) {
                    ke3 = parseFloat(distances3) + 315.61;
                    console.log("hasil akhir rumus 3", ke3);
                  } else if(lastreader3 == 0){
                    ke3 = parseFloat(distances3) + 115.61;
                    console.log("hasil akhir rumus 4", ke3);
                  } else {
                    ke3 = parseFloat(distances3) + 400;
                    console.log("hasil akhir rumus 5", ke3);
                  }

                  // Resolve the promise with the updated distance value
                  resolve(ke3);
                }
              }
            );
          });

          // Wait for the promise to resolve before executing the update
          updateDistancePromise3.then(updatedDistance3 => {
            DB.run(
              "UPDATE test_participants SET distance = ?, temp_distance = ? WHERE id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
              [updatedDistance3, 0, testParticipantId, chipId],
              (error) => {
                if (error) {
                  console.error("Error updating distance:", error);
                } else {
                  console.log("Distance updated successfully");
                  console.log(updatedDistance3);
          
                  // Add the query to retrieve devId
                  DB.get(
                    "SELECT devId FROM devices WHERE id = (SELECT device_id FROM test_participants WHERE id = ?)",
                    [testParticipantId],
                    (error, result) => {
                      if (error) {
                        console.error("Error retrieving devId:", error);
                      } else {
                        // Check if devId is found
                        if (result && result.devId) {
                          const devId = result.devId;
          
                          // Find GPS_LOG with id and remove its entry
                          const gpsLogEntryIndex = GPS_LOG.findIndex({ id: devId });
                          if (gpsLogEntryIndex !== -1) {
                            GPS_LOG.remove({ id: devId }).write();
                            console.log("GPS_LOG entry removed successfully");
                          } else {
                            console.log("GPS_LOG entry not found for devId:", devId);
                          }
                        } else {
                          console.log("No devId found for the given testParticipantId:", testParticipantId);
                        }
                      }
                    }
                  );
                }
              }
            );
          });

          break;

        case 4:
          let ke4 = 0.0;

          // Use a promise to wrap the database operation
          const updateDistancePromise4 = new Promise((resolve, reject) => {
            DB.all(
              "SELECT distance, lastreader FROM test_participants WHERE id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
              [testParticipantId, chipId],
              (error, rows) => {
                if (error) {
                  console.error("Error updating distance:", error);
                  reject(error);
                } else {
                  let distances4 = rows.map(row => row.distance);
                  let lastreader4 = rows.map(row => row.lastreader);
                  if (lastreader4 == 3) {
                    ke4 = parseFloat(distances4) + 84.39;
                    console.log("hasil akhir", ke4);
                  } else if(lastreader4 == 2) {
                    ke4 = parseFloat(distances4) + 200;
                    console.log("hasil akhir", ke4);
                  } else if(lastreader4 == 1) {
                    ke4 = parseFloat(distances4) + 284.39;
                    console.log("hasil akhir", ke4);
                  } else if(lastreader4 == 0){
                    ke4 = parseFloat(distances4) + 200;
                    console.log("hasil akhir", ke4);
                  }  else {
                    ke4 = parseFloat(distances4) + 400;
                    console.log("hasil akhir", ke4);
                  }

                  // Resolve the promise with the updated distance value
                  resolve(ke4);
                }
              }
            );
          });

          // Wait for the promise to resolve before executing the update
          updateDistancePromise4.then(updatedDistance4 => {
            DB.run(
              "UPDATE test_participants SET distance = ?, temp_distance = ? WHERE id = ? AND chip_id = ? AND (finished = 0 OR finished IS NULL)",
              [updatedDistance4, 0, testParticipantId, chipId],
              (error) => {
                if (error) {
                  console.error("Error updating distance:", error);
                } else {
                  console.log("Distance updated successfully");
                  console.log(updatedDistance4);
          
                  // Add the query to retrieve devId
                  DB.get(
                    "SELECT devId FROM devices WHERE id = (SELECT device_id FROM test_participants WHERE id = ?)",
                    [testParticipantId],
                    (error, result) => {
                      if (error) {
                        console.error("Error retrieving devId:", error);
                      } else {
                        // Check if devId is found
                        if (result && result.devId) {
                          const devId = result.devId;
          
                          // Find GPS_LOG with id and remove its entry
                          const gpsLogEntryIndex = GPS_LOG.findIndex({ id: devId });
                          if (gpsLogEntryIndex !== -1) {
                            GPS_LOG.remove({ id: devId }).write();
                            console.log("GPS_LOG entry removed successfully");
                          } else {
                            console.log("GPS_LOG entry not found for devId:", devId);
                          }
                        } else {
                          console.log("No devId found for the given testParticipantId:", testParticipantId);
                        }
                      }
                    }
                  );
                }
              }
            );
          });

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

        DB.run(
          "UPDATE test_participants SET lastreader = ? WHERE id = ?",
          [readerId, testParticipantId],
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
      [DISTANCE]: gpsData.map(async ({ devId, testParticipantId, gps }) => ({
        id: await getDeviceId(devId),
        isOnline: true,
        isWeared: true,
        isGpsReady: true,
        lastlat: gps.latitude,
        lastlon: gps.longitude,
        distance: getDistance(testParticipantId),
        temp_distance: getTempDistance(testParticipantId),
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
        DB.all("SELECT * FROM readers ORDER BY readerId ASC", (err, rows) => {
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

async function addParticipant(_, { participants }) {
  //console.log("test")
  try {

    const insertQueries = participants.map(participant => {
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
    });

    // Execute all the insert queries using Promise.all
    const ids = await Promise.all(insertQueries);
    return ids;
  } catch (err) {
    throw err;
  }
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
          d.id as deviceId,
          c.codeChip,
          c.id as chipId
        FROM
          test_participants tp 
        LEFT JOIN
          participants p ON tp.participant_id = p.id
        LEFT JOIN
          devices d ON tp.device_id = d.id
        LEFT JOIN
          chips c ON tp.chip_id = c.id
        WHERE test_id = ?
        GROUP BY tp.id
        ORDER BY deviceId`,
        [test.id],
        (err, rows) => {
          if (err) reject(err);

          resolve(
            rows.map((row) => ({
              id: row.id,
              number: row.participant_number,
              code: row.code,
              codeChip: row.codeChip,
              fullname: row.fullname,
              deviceId: row.deviceId,
              deviceChipId: row.chipId,
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

async function addTest(_, {
  eventName,
  timeScheduled,
  mode,
  coach,
  committee,
  location,
  participants,
  category,
}) {
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
        else resolve(this.lastID);
      }
    );
  });

  const participantPromises = participants.map(p => {
    return new Promise((resolve, reject) => {
      DB.run(
        "INSERT INTO test_participants(test_id, participant_id, participant_number, device_id, chip_id) VALUES(?, ?, ?, ?, ?)",
        [testId, p.participantId, p.number, p.deviceId, p.deviceChipId],
        function (err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  });

  await Promise.all(participantPromises);

  for (const p of participants) {
    try {
      const row = await new Promise((resolve, reject) => {
        DB.get(
          "SELECT id FROM test_participants WHERE test_id = ? AND participant_id = ? AND finished IS NULL",
          [testId, p.participantId],
          function (err, row) {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (row) {
        const testParticipantID = row.id;
        const chipdeviceId = await new Promise((resolve, reject) => {
          DB.get(
            "SELECT id, chipId FROM chips WHERE id = ?",
            [Number(p.deviceChipId)],
            function (err, row) {
              if (err) reject(err);
              else resolve(row.chipId);
            }
          );
        });

/*
        client.publish(`chipready/${testParticipantID}/${chipdeviceId}/${p.deviceChipId}`, '', function (err) {
          if (err) {
            console.log(err);
          }
        });
*/

      }
    } catch (err) {
      console.log(err);
    }
  }

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
          "INSERT INTO test_participants(test_id, participant_id, participant_number, device_id, chip_id) VALUES(?, ?, ?, ?, ?)",
          [test.id, p.participantId, p.number, p.deviceId, p.deviceChipId]
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

    const headingrf1 = calculateHeading1(reader.cenlaplat, reader.cenlaplon, reader.latt1, reader.lonn1)
    const headingrf2 = calculateHeading1(reader.cenlaplat, reader.cenlaplon, reader.latt2, reader.lonn2)
    const headingrf3 = calculateHeading1(reader.cenlaplat, reader.cenlaplon, reader.latt3, reader.lonn3)
    const headingrf4 = calculateHeading1(reader.cenlaplat, reader.cenlaplon, reader.latt4, reader.lonn4)

    return new Promise((resolve, reject) => {
        DB.run(
            "DELETE FROM readers",
            function (err) {
              if (err) reject(err);
      
              resolve(true);
            }
          );
    
      DB.run(
        "INSERT INTO readers(readerId, codeReader, latitude, longitude, centerlaplat, centerlaplon, headingcentertorf) VALUES(?,?,?,?,?,?,?)",
        [1, "RFID 1", reader.latt1, reader.lonn1, reader.cenlaplat, reader.cenlaplon, headingrf1],
        function (err) {
          if (err) reject(err);
  
          resolve(true);
        }
      );

      DB.run(
        "INSERT INTO readers(readerId, codeReader, latitude, longitude, centerlatitude, centerlongitude, centerlaplat, centerlaplon, headingcentertorf) VALUES(?,?,?,?,?,?,?,?,?)",
        [2, "RFID 2", reader.latt2, reader.lonn2, reader.centerlat1, reader.centerlon1, reader.cenlaplat, reader.cenlaplon, headingrf2],
        function (err) {
          if (err) reject(err);
  
          resolve(true);
        }
      );

      DB.run(
        "INSERT INTO readers(readerId, codeReader, latitude, longitude, centerlaplat, centerlaplon, headingcentertorf) VALUES(?,?,?,?,?,?,?)",
        [3, "RFID 3", reader.latt3, reader.lonn3, reader.cenlaplat, reader.cenlaplon, headingrf3],
        function (err) {
          if (err) reject(err);
  
          resolve(true);
        }
      );

      DB.run(
        "INSERT INTO readers(readerId, codeReader, latitude, longitude, centerlatitude, centerlongitude, centerlaplat, centerlaplon, headingcentertorf) VALUES(?,?,?,?,?,?,?,?,?)",
        [4, "RFID 4", reader.latt4, reader.lonn4, reader.centerlat2, reader.centerlon2, reader.cenlaplat, reader.cenlaplon, headingrf4],
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
                SELECT d.id, d.devId, d.code, c.id AS c_id, c.chipId, c.codeChip, participant_id, tp.id AS tp_id
                FROM test_participants tp
                JOIN devices d ON tp.device_id = d.id
                JOIN chips c ON tp.chip_id = c.id
                WHERE test_id = ?`,
          [Number(testId)],
          function (err, rows) {
            if (err) reject(err);

            rows.forEach((r) => idMappings.set(r.devId, r.id));

            rows.forEach((toreader) => 
              client.publish(`chipready/${toreader.tp_id}/${toreader.chipId}/${toreader.c_id}`, '', function (err) {
                if (err) {
                  console.log(err);
                }
              })
            );

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
  if (currentTimer !== null) {
    currentTimer.unsubscribe();
    currentTimer = null;
  }

  if (currentTimer2 !== null) {
    currentTimer2.unsubscribe();
    currentTimer2 = null;
  }

  try {
    const ongoingParticipants = await DB.pAll(Q_GET_ONGOING_PARTICIPANTS);

    await DB.pRun(
      squel
        .update()
        .table("tests")
        .set("status", "CANCELED")
        .set("startTimestamp", null)
        .set("finishTimestamp", null)
        .where("id = ?", id)
        .toString()
    );

    await DB.pRun(
      squel
        .update()
        .table("test_participants")
        .set("distance", 0.0)
        .set("time", null)
        .set("finished", null)
        .set("score", null)
        .set("lastlat", null)
        .set("lastlon", null)
        .set("lastreader", 0)
        .set("temp_distance", 0.0)
        .where("test_id = ?", id)
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
      participants.map(async (p) => {
        const current = GPS_LOG.find({
          id: p.devId,
        });

        //const distance = getPathLength(current.get("data").value());
        let distance = p.distance;

        let lastreader = p.lastreader;
        let actualcp1 = 0;
        let actualcp2 = 0;
        let actual_reader = 0;
        let lastlat = p.lastlat;
        let lastlon = p.lastlon;
        let latrf = 0.0;
        let lonrf = 0.0;
        let latcen = 0.0;
        let loncen = 0.0;
        let headingpesertacp1 = 0.0;
        let headingpesertacp2 = 0.0;

        const centerlaplat = [];
        const centerlaplon = [];
        const allheading = [];
        const allrflat = [];
        const allrflon = [];
        const allcplat = [];
        const allcplon = [];
        
        // Create a function that performs the database query and returns a Promise
        function fetchDataFromDB() {
          return new Promise((resolve, reject) => {
            DB.all("SELECT * FROM readers ORDER BY readerId ASC", (error, rows) => {
              if (error) {
                console.error(error);
                reject(error);
              } else {
                // Iterate through the rows and push data into respective arrays
                rows.forEach(row => {
                  //allheading.push(row.headingcentertorf);
                  //centerlaplat.push(row.centerlaplat);
                  //centerlaplon.push(row.centerlaplon);

                  allrflat.push(row.latitude)
                  allrflon.push(row.longitude)
                  allcplat.push(row.centerlatitude)
                  allcplon.push(row.centerlongitude)

                });

                // Resolve the Promise
                resolve();
              }
            });
          });
        }

        // Call the function to fetch data
        fetchDataFromDB()
          .then(() => {
            headingpesertacp1 = calculateHeading1(allcplat[1], allcplon[1], lastlat, lastlon);
            headingpesertacp2 = calculateHeading1(allcplat[3], allcplon[3], lastlat, lastlon);
            hitung0 = calculateHeading1(allrflat[2], allrflon[2], allrflat[3], allrflon[3]);
            hitung0 = parseFloat(hitung0);
            console.log("");
            console.log("HEADING PESERTA DARI CP1: ", headingpesertacp1);
            console.log("HEADING PESERTA DARI CP2: ", headingpesertacp2);

            //PERHITUNGAN CP 1
            if ((headingpesertacp1 > hitung0) && (headingpesertacp1 < hitung0+90)) {
              actualcp1 = 3;
            } else if ((headingpesertacp1 > hitung0+90) && (headingpesertacp1 < hitung0+270)) {
              actualcp1 = 2;
            } else if ((headingpesertacp1 > hitung0+270) && (headingpesertacp1 < 360)) {
              actualcp1 = 1;
            }

            //PERHITUNGAN CP 2
            if ((headingpesertacp2 > hitung0+270) && (headingpesertacp2 < 360)) {
              actualcp2 = 4;
            } else if ((headingpesertacp2 > hitung0) && (headingpesertacp2 < hitung0+90)) {
              actualcp2 = 4;
            } else if ((headingpesertacp2 > hitung0+90) && (headingpesertacp2 < hitung0+180)) {
              actualcp2 = 3;
            } else if ((headingpesertacp2 > hitung0+180) && (headingpesertacp2 < hitung0+270)) {
              actualcp2 = 1;
            }

            console.log("ACTUAL CP1 : " ,actualcp1)
            console.log("ACTUAL CP2 : ",actualcp2)

            //RUMUS PENENTUAN HASIL DARI CP1 & CP2
            if (actualcp1 != actualcp2){
              if ((actualcp1 == 2) || (actualcp1 == 4)) {
                actual_reader = actualcp1;
                
              } else if ((actualcp2 == 2) || (actualcp2 == 4)) {
                actual_reader = actualcp2
              }
            } else {
              actual_reader = actualcp1
            }

            //console.log("Actual Reader : ", actual_reader);

            // Chain the second query to ensure it's executed after the first one
            return new Promise((resolve, reject) => {
              //console.log("ACTUAL SEBELUM DB.ALL : ", actual_reader);
              DB.all("SELECT * FROM readers WHERE readerId = ?", [actual_reader], (error, rows) => {
                if (error) {
                  console.error(error);
                  reject(error);
                } else {
                  latrf = rows.map(row => row.latitude);
                  lonrf = rows.map(row => row.longitude);
                  latcen = rows.map(row => row.centerlatitude);
                  loncen = rows.map(row => row.centerlongitude);
                  resolve([latrf, lonrf, latcen, loncen]);
                }
              });
            });
          })
          .then(latlonrfData => {
            // Here, latlonrfData contains the resolved data from the second query
            const [latrf, lonrf, latcen, loncen] = latlonrfData;
            //console.log("latrf:", latrf);
            //console.log("lonrf:", lonrf);
            //console.log("latcen:", latcen);
            //console.log("loncen:", loncen);

            console.log("LAST READER : ", lastreader);
            console.log("ACTUAL READER : ", actual_reader);

            if (lastreader == 1) {
              if (actual_reader == 2) {
                distance = p.distance + 84.39;
              } else if (actual_reader == 3) {
                distance = p.distance + 200;
              } else if (actual_reader == 4) {
                distance = p.distance + 284.39;
              } else {
                distance = p.distance;
              }

            } else if (lastreader == 2) {
              if (actual_reader == 2) {
                distance = p.distance;
              } else if (actual_reader == 3) {
                distance = p.distance + 115.61;
              } else if (actual_reader == 4) {
                distance = p.distance + 200;
              } else {
                distance = p.distance + 315.61;
              }

            } else if (lastreader == 3) {
              if (actual_reader == 2) {
                distance = p.distance + 284.39;
              } else if (actual_reader == 3) {
                distance = p.distance;
              } else if (actual_reader == 4) {
                distance = p.distance + 84.39;
              } else {
                distance = p.distance + 200;
              }

            } else if (lastreader == 4) {
              if (actual_reader == 2) {
                distance = p.distance + 200;
              } else if (actual_reader == 3) {
                distance = p.distance + 315.61;
              } else if (actual_reader == 4) {
                distance = p.distance;
              } else {
                distance = p.distance + 115.61;
              }
            }

            distance = parseFloat(distance);
            console.log("DISTANCE : ", distance);
            lastreader = actual_reader;
            console.log("latcen : ", latcen);
            console.log("loncen : ", loncen);

            if ((lastreader == 2) || (lastreader == 4)) {
              distance = distance + hasilakhirlengkung(parseFloat(latrf), parseFloat(lonrf), lastlat, lastlon, parseFloat(latcen), parseFloat(loncen));
              distance = distance.toFixed(2);
              console.log("distance + hasil lengkung", distance);
            } else {
              distance = distance + hasilakhirlurus(parseFloat(latrf), parseFloat(lonrf), lastlat, lastlon);
              distance = distance.toFixed(2);
              console.log("distance + hasil lurus", distance);
            }

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
            //console.log("OnGoing Timer : ", ongoingTimer);
    
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
          .catch(error => {
            // Handle any errors that occur during the database query
            console.error("Error:", error);
          });
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

//////// PEMISAHAN PEMANGGILAN FUNCTION LENGKUNG DAN TIDAK /////////
//lat1 dan long 1 = RFID terkahir
//lat2 dan long 2 = Posisi Peserta Terakhir
//lat center long center = center point mengambil dari tabel Reader
function hasilakhirlengkung(lat1, lon1, lat2, lon2, latcenter, loncenter) {
  //console.log("ALL DATA: ", lat1, lon1, lat2, lon2, latcenter, loncenter);
  const heading1 = calculateHeading1(latcenter, loncenter, lat1, lon1);
  const heading2 = calculateHeading2(latcenter, loncenter, lat2, lon2);
  console.log("Heading 1", heading1);
  console.log("Heading 2", heading2);
  let selisih = heading1 - heading2;
  console.log("Selisih Heading", selisih);

  if (selisih < 0) {
    console.log("HEADING RF :" ,heading1)
    console.log("HEADING PESERTA : ",heading2)
    selisih = (parseFloat(heading1) + (360 - heading2));
    console.log("HASIL REVISI : ",selisih);
  }

  const jarak = (parseFloat(selisih) / 360) * (2 * 3.14 * 36.8);
  //console.log("SELISIH DILUAR IF :",selisih)
  //console.log("TEST JARAK: ",jarak)
  console.log("Distance Lengkung", jarak.toFixed(2));

  return jarak
}

///////// VINCENTY /////////////////////////////
function hasilakhirlurus(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371; // Radius of the Earth in kilometers

  const toRadians = angle => (angle * Math.PI) / 180;

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaLambda = toRadians(lon2 - lon1);

  const numerator = Math.sqrt(
    Math.pow(Math.cos(phi2) * Math.sin(deltaLambda), 2) +
      Math.pow(
        Math.cos(phi1) * Math.sin(phi2) -
          Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda),
        2
      )
  );
  const denominator =
    Math.sin(phi1) * Math.sin(phi2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const angularDistance = Math.atan2(numerator, denominator);
  const hasil = earthRadius * angularDistance;
  const hasil2 = hasil * 1000;

  return hasil2;
}

///////// UBAH KE RADIAN //////////////////
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

////// HEADING UNTUK LENGKUNG //////////////////////
function calculateHeading1(lat1, lon1, lat2, lon2) {
  
  lat1 = toRadians(lat1);
  lon1 = toRadians(lon1);
  lat2 = toRadians(lat2);
  lon2 = toRadians(lon2);

  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let heading = Math.atan2(y, x) * (180 / Math.PI);
  heading = (heading + 360) % 360;

  finalHeading = heading.toFixed(2);

  return finalHeading
}

function calculateHeading2(lat1, lon1, lat2, lon2) {
  lat1 = toRadians(lat1);
  lon1 = toRadians(lon1);
  lat2 = toRadians(lat2);
  lon2 = toRadians(lon2);

  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let heading = Math.atan2(y, x) * (180 / Math.PI);
  heading = (heading + 360) % 360;

  finalHeading = heading.toFixed(2);

  return finalHeading
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

function getDistance(testParticipantId) {
  return new Promise((resolve, reject) => {
    DB.get(
        "SELECT * FROM test_participants WHERE id = ?",
        [testParticipantId],
        function (err, row) {
          if (err) reject(err);

          if (row) {
            resolve(row.distance);
          } else {
            resolve(null);
          }
        }
      );
  });
};

function getTempDistance(testParticipantId) {
  return new Promise((resolve, reject) => {
    DB.get(
        "SELECT * FROM test_participants WHERE id = ?",
        [testParticipantId],
        function (err, row) {
          if (err) reject(err);

          if (row) {
            resolve(row.temp_distance);
          } else {
            resolve(null);
          }
        }
      );
  });
};

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
            WHERE test_id = ? AND canceled = 0
            ORDER BY tp.participant_number`,
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
            //isWeared: true,
            //isOnline: true,
            //isGpsReady: true,
            isFinished: x.finished,
            battery: null,
            heartRate: null,
            distance: x.distance,
            heartRateThreshold: getHeartRateThreshold(x.birthDate),
            WAKTOS: x.time,
            lastlat: x.lastlat,
            lastlon: x.lastlon,
            temp_distance: x.temp_distance
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
            ORDER BY tp.participant_number
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

function calculateScoreMale(age, totalDistance) {
  if (age >= 18 && age <= 25) {
    let score = 100;
    let distance = 3507;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }
    
    return score;
  } else if (age >= 26 && age <= 30) {
    let score = 100;
    let distance = 3412;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }
    
    return score;
  } else if (age >= 31 && age <= 35) {
    let score = 100;
    let distance = 3317;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }
    
    return score;
  } else if (age >= 36 && age <= 40) {
    let score = 100;
    let distance = 3222;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }
    
    return score;
  } else if (age >= 41 && age <= 43) {
    let score = 100;
    let distance = 3127;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }
    
    return score;
  } else if (age >= 44 && age <= 46) {
    let score = 100;
    let distance = 3032;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }
    
    return score;
  } else if (age >= 47 && age <= 49) {
    let score = 100;
    let distance = 2937;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }
    
    return score;
  } else if (age >= 50 && age <= 52) {
    let score = 100;
    let distance = 2842;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }
    
    return score;
  } else if (age >= 53 && age <= 55) {
    let score = 100;
    let distance = 2747;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }
    
    return score;
  } else if (age >= 56 && age <= 58) {
    let score = 100;
    let distance = 2652;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }
    
    return score;
  } else {
    return 0; // Age is outside all specified ranges, so the score is 0
  }
}

function calculateScoreMale2(totalDistance) {
  const data = [
      { min: 0, max: 1476, score: 0 },
      { min: 1476, max: 1482, score: 1 },
      { min: 1482, max: 1498, score: 2 },
      { min: 1498, max: 1514, score: 3 },
      { min: 1514, max: 1530, score: 4 },
      { min: 1530, max: 1546, score: 5 },
      { min: 1546, max: 1552, score: 6 },
      { min: 1552, max: 1568, score: 7 },
      { min: 1568, max: 1584, score: 8 },
      { min: 1584, max: 1600, score: 9 },
      { min: 1600, max: 1616, score: 10 },
      { min: 1616, max: 1632, score: 11 },
      { min: 1632, max: 1648, score: 12 },
      { min: 1648, max: 1664, score: 13 },
      { min: 1664, max: 1680, score: 14 },
      { min: 1680, max: 1696, score: 15 },
      { min: 1696, max: 1712, score: 16 },
      { min: 1712, max: 1728, score: 17 },
      { min: 1728, max: 1744, score: 18 },
      { min: 1744, max: 1760, score: 19 },
      { min: 1760, max: 1776, score: 20 },
      { min: 1776, max: 1792, score: 21 },
      { min: 1792, max: 1808, score: 22 },
      { min: 1808, max: 1824, score: 23 },
      { min: 1824, max: 1840, score: 24 },
      { min: 1840, max: 1856, score: 25 },
      { min: 1856, max: 1872, score: 26 },
      { min: 1872, max: 1888, score: 27 },
      { min: 1888, max: 1904, score: 28 },
      { min: 1904, max: 1920, score: 29 },
      { min: 1920, max: 1936, score: 30 },
      { min: 1936, max: 1952, score: 31 },
      { min: 1952, max: 1968, score: 32 },
      { min: 1968, max: 1984, score: 33 },
      { min: 1984, max: 2000, score: 34 },
      { min: 2000, max: 2016, score: 35 },
      { min: 2016, max: 2032, score: 36 },
      { min: 2032, max: 2048, score: 37 },
      { min: 2048, max: 2064, score: 38 },
      { min: 2064, max: 2080, score: 39 },
      { min: 2080, max: 2096, score: 40 },
      { min: 2096, max: 2112, score: 41 },
      { min: 2112, max: 2128, score: 42 },
      { min: 2128, max: 2144, score: 43 },
      { min: 2144, max: 2160, score: 44 },
      { min: 2160, max: 2176, score: 45 },
      { min: 2176, max: 2192, score: 46 },
      { min: 2192, max: 2208, score: 47 },
      { min: 2208, max: 2224, score: 48 },
      { min: 2224, max: 2240, score: 49 },
      { min: 2240, max: 2260, score: 50 },
      { min: 2260, max: 2280, score: 51 },
      { min: 2280, max: 2300, score: 52 },
      { min: 2300, max: 2320, score: 53 },
      { min: 2320, max: 2340, score: 54 },
      { min: 2340, max: 2360, score: 55 },
      { min: 2360, max: 2380, score: 56 },
      { min: 2380, max: 2400, score: 57 },
      { min: 2400, max: 2420, score: 58 },
      { min: 2420, max: 2440, score: 59 },
      { min: 2440, max: 2460, score: 60 },
      { min: 2460, max: 2480, score: 61 },
      { min: 2480, max: 2500, score: 62 },
      { min: 2500, max: 2520, score: 63 },
      { min: 2520, max: 2540, score: 64 },
      { min: 2540, max: 2560, score: 65 },
      { min: 2560, max: 2580, score: 66 },
      { min: 2580, max: 2600, score: 67 },
      { min: 2600, max: 2620, score: 68 },
      { min: 2620, max: 2640, score: 69 },
      { min: 2640, max: 2660, score: 70 },
      { min: 2660, max: 2680, score: 71 },
      { min: 2680, max: 2700, score: 72 },
      { min: 2700, max: 2720, score: 73 },
      { min: 2720, max: 2740, score: 74 },
      { min: 2740, max: 2760, score: 75 },
      { min: 2760, max: 2780, score: 76 },
      { min: 2780, max: 2800, score: 77 },
      { min: 2800, max: 2820, score: 78 },
      { min: 2820, max: 2840, score: 79 },
      { min: 2840, max: 2860, score: 80 },
      { min: 2860, max: 2880, score: 81 },
      { min: 2880, max: 2900, score: 82 },
      { min: 2900, max: 2920, score: 83 },
      { min: 2920, max: 2940, score: 84 },
      { min: 2940, max: 2960, score: 85 },
      { min: 2960, max: 2980, score: 86 },
      { min: 2980, max: 3000, score: 87 },
      { min: 3000, max: 3020, score: 88 },
      { min: 3020, max: 3040, score: 89 },
      { min: 3040, max: 3060, score: 90 },
      { min: 3060, max: 3080, score: 91 },
      { min: 3080, max: 3100, score: 92 },
      { min: 3100, max: 3120, score: 93 },
      { min: 3120, max: 3140, score: 94 },
      { min: 3140, max: 3160, score: 95 },
      { min: 3160, max: 3180, score: 96 },
      { min: 3180, max: 3200, score: 97 },
      { min: 3200, max: 3220, score: 98 },
      { min: 3220, max: 3240, score: 99 },
      { min: 3240, max: Infinity, score: 100 }
  ];

  const result = data.find(item => totalDistance >= item.min && totalDistance < item.max);
  return result ? result.score : null;
}

function calculateScoreFemale(age, totalDistance) {
  if (age >= 18 && age <= 25) {
    let score = 100;
    let distance = 2630;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }

    return score;
  } else if (age >= 26 && age <= 30) {
    let score = 100;
    let distance = 2575;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }

    return score;
  } else if (age >= 31 && age <= 35) {
    let score = 100;
    let distance = 2520;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }

    return score;
  } else if (age >= 36 && age <= 40) {
    let score = 100;
    let distance = 2465;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }

    return score;
  } else if (age >= 41 && age <= 43) {
    let score = 100;
    let distance = 2410;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }

    return score;
  } else if (age >= 44 && age <= 46) {
    let score = 100;
    let distance = 2355;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }

    return score;
  } else if (age >= 47 && age <= 49) {
    let score = 100;
    let distance = 2300;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }

    return score;
  } else if (age >= 50 && age <= 52) {
    let score = 100;
    let distance = 2245;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }

    return score;
  } else if (age >= 53 && age <= 55) {
    let score = 100;
    let distance = 2190;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }

    return score;
  } else if (age >= 56 && age <= 58) {
    let score = 100;
    let distance = 2135;

    while (distance > totalDistance && score > 0) {
      distance -= 19;
      score--;
    }

    return score;
  } else {
    return 0; // Age is outside all specified ranges, so the score is 0
  }
}

function calculateScoreFemale2(totalDistance) {
  const data = [
      { min: 0, max: 1337, score: 0 },
      { min: 1337, max: 1348, score: 2 },
      { min: 1348, max: 1360, score: 3 },
      { min: 1360, max: 1371, score: 4 },
      { min: 1371, max: 1382, score: 5 },
      { min: 1382, max: 1393, score: 6 },
      { min: 1393, max: 1404, score: 7 },
      { min: 1404, max: 1416, score: 8 },
      { min: 1416, max: 1427, score: 9 },
      { min: 1427, max: 1438, score: 10 },
      { min: 1438, max: 1449, score: 11 },
      { min: 1449, max: 1460, score: 12 },
      { min: 1460, max: 1472, score: 13 },
      { min: 1472, max: 1483, score: 14 },
      { min: 1483, max: 1494, score: 15 },
      { min: 1494, max: 1505, score: 16 },
      { min: 1505, max: 1516, score: 17 },
      { min: 1516, max: 1528, score: 18 },
      { min: 1528, max: 1539, score: 19 },
      { min: 1539, max: 1550, score: 20 },
      { min: 1550, max: 1561, score: 21 },
      { min: 1561, max: 1572, score: 22 },
      { min: 1572, max: 1584, score: 23 },
      { min: 1584, max: 1595, score: 24 },
      { min: 1595, max: 1606, score: 25 },
      { min: 1606, max: 1617, score: 26 },
      { min: 1617, max: 1628, score: 27 },
      { min: 1628, max: 1640, score: 28 },
      { min: 1640, max: 1651, score: 29 },
      { min: 1651, max: 1662, score: 30 },
      { min: 1662, max: 1673, score: 31 },
      { min: 1673, max: 1684, score: 32 },
      { min: 1684, max: 1696, score: 33 },
      { min: 1696, max: 1707, score: 34 },
      { min: 1707, max: 1718, score: 35 },
      { min: 1718, max: 1729, score: 36 },
      { min: 1729, max: 1740, score: 37 },
      { min: 1740, max: 1752, score: 38 },
      { min: 1752, max: 1763, score: 39 },
      { min: 1763, max: 1774, score: 40 },
      { min: 1774, max: 1785, score: 41 },
      { min: 1785, max: 1796, score: 42 },
      { min: 1796, max: 1808, score: 43 },
      { min: 1808, max: 1819, score: 44 },
      { min: 1819, max: 1830, score: 45 },
      { min: 1830, max: 1841, score: 46 },
      { min: 1841, max: 1852, score: 47 },
      { min: 1852, max: 1864, score: 48 },
      { min: 1864, max: 1875, score: 49 },
      { min: 1875, max: 1886, score: 50 },
      { min: 1886, max: 1897, score: 51 },
      { min: 1897, max: 1908, score: 52 },
      { min: 1908, max: 1919, score: 53 },
      { min: 1919, max: 1931, score: 54 },
      { min: 1931, max: 1942, score: 55 },
      { min: 1942, max: 1953, score: 56 },
      { min: 1953, max: 1964, score: 57 },
      { min: 1964, max: 1976, score: 58 },
      { min: 1976, max: 1987, score: 59 },
      { min: 1987, max: 1998, score: 60 },
      { min: 1998, max: 2009, score: 61 },
      { min: 2009, max: 2020, score: 62 },
      { min: 2020, max: 2032, score: 63 },
      { min: 2032, max: 2043, score: 64 },
      { min: 2043, max: 2054, score: 65 },
      { min: 2054, max: 2065, score: 66 },
      { min: 2065, max: 2076, score: 67 },
      { min: 2076, max: 2088, score: 68 },
      { min: 2088, max: 2099, score: 69 },
      { min: 2099, max: 2110, score: 70 },
      { min: 2110, max: 2121, score: 71 },
      { min: 2121, max: 2132, score: 72 },
      { min: 2132, max: 2144, score: 73 },
      { min: 2144, max: 2155, score: 74 },
      { min: 2155, max: 2166, score: 75 },
      { min: 2166, max: 2177, score: 76 },
      { min: 2177, max: 2188, score: 77 },
      { min: 2188, max: 2200, score: 78 },
      { min: 2200, max: 2211, score: 79 },
      { min: 2211, max: 2222, score: 80 },
      { min: 2222, max: 2233, score: 81 },
      { min: 2233, max: 2244, score: 82 },
      { min: 2244, max: 2256, score: 83 },
      { min: 2256, max: 2267, score: 84 },
      { min: 2267, max: 2278, score: 85 },
      { min: 2278, max: 2289, score: 86 },
      { min: 2289, max: 2300, score: 87 },
      { min: 2300, max: 2312, score: 88 },
      { min: 2312, max: 2323, score: 89 },
      { min: 2323, max: 2334, score: 90 },
      { min: 2334, max: 2345, score: 91 },
      { min: 2345, max: 2356, score: 92 },
      { min: 2356, max: 2368, score: 93 },
      { min: 2368, max: 2379, score: 94 },
      { min: 2379, max: 2390, score: 95 },
      { min: 2390, max: 2401, score: 96 },
      { min: 2401, max: 2412, score: 97 },
      { min: 2412, max: 2424, score: 98 },
      { min: 2424, max: 2435, score: 99 },
      { min: 2435, max: Infinity, score: 100 }
  ];

  const result = data.find(item => totalDistance >= item.min && totalDistance < item.max);
  return result ? result.score : null;
}

function getScore(mode, gender, distance, time = null, age) {
  const map = new Map([
    [
      1,
      new Map([
        [
          "MALE",
          calculateScoreMale2(distance),
        ],
        [
          "FEMALE",
          calculateScoreFemale2(distance),
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
