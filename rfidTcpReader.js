// Include Nodejs' net module.
const Net = require('net');
const packetUtils = require('./packet.js')
const mqtt = require("async-mqtt");
const { fromEvent} = require("rxjs");
const { bufferTime, filter, map, take, tap } = require("rxjs/operators");


//CONFIG
// The port number and hostname of the server.
const host = ["192.168.0.178","127.0.0.1","127.0.0.1","127.0.0.1"]
const port = [4001,4002,4003,4004]
const MQTT_HOST = "tcp://localhost:1883";


var countReader = 1
const activeTimeout = 2000
var client=[]
var searchStrings = [];
var dobArraySearchStrings = [];

//const client = mqtt.connect(MQTT_HOST);
const clientmqtt = mqtt.connect(MQTT_HOST);

//MQTT Subcription from Publish on Apps AJPv3
const onConnect = fromEvent(clientmqtt, "connect");
const onMessage = fromEvent(clientmqtt, "message");

onConnect.subscribe(() =>
  clientmqtt.subscribe([
    "chipready/#"
  ])
);

const onChipReady = onMessage.pipe(
	filter((data) => data[0].startsWith("chipready/")),
	map((data) => data.concat([Date.now()])),
	bufferTime(500),
	filter((data) => data.length),
	map((all) =>
	  all.map((data) => {
		const topicParts = data[0].split("/");
		console.log("Topic Parts:", topicParts); // Add this line for debugging
  
		const chipId = topicParts[2].toString();
		const testParticipantId = topicParts[1].toString();
		const idchip = topicParts[3].toString();
  
		console.log("Received Chip Id:", chipId);
		console.log("Received Test Participant Id:", testParticipantId);
		console.log("Received Id Chip:", idchip);
  
		return {
		  chipId: String(chipId),
		  testParticipantId: testParticipantId ? Number(testParticipantId) : null,
		  idchip: Number(idchip),
		};
	  })
	)
  );
  
  // Subscribe to the chipStatusReady observable
  onChipReady.subscribe((chipStatusReady) => {
	chipStatusReady
	  .filter(({ testParticipantId }) => testParticipantId !== null)
	  .forEach(({ testParticipantId, chipId, idchip }) => {
		// Create the search string array
		const searchString = [testParticipantId, chipId, idchip];
  
		// Add the search string array to the searchStrings array
		searchStrings.push(searchString);
	  });
  
	// Log the updated searchStrings array
	//console.log("Print Value Array MQTT:", searchStrings);
	dobArraySearchStrings = searchStrings;
  
	//console.log("Updated dobArraySearchStrings array:", dobArraySearchStrings);
  });


// Creating a client socket
for (let i=0;i<countReader;i++)
{
	client[i] = new Net.Socket();
}

function sendData(packet,len)
{
	for (let i=0;i<countReader;i++)
		client[i].write(packet.subarray(0,len))
}

function cmd_fast_switch_ant_inventory()
{
	var packet=new Uint8Array(100);
	var addr=1;
	var cmd=0x8A;
    let i=0;
    packet[i++]=0xA0;
    packet[i++];
    packet[i++]=addr;
    packet[i++]=cmd;
    packet[i++]=0;
    packet[i++]=1;
    packet[i++]=1;
    packet[i++]=1;
    packet[i++]=2;
    packet[i++]=1;
    packet[i++]=3;
    packet[i++]=1;
    packet[i++]=0;
    packet[i++]=1;

    packet[1]=i-1;
    packet[i++]=packetUtils.checksum(packet,i);
    var len=i;
	sendData(packet,len)
//	console.log("len="+len)
//	console.log('send:'+packetUtils.dump(packet.subarray(0,len)))
}

class ListCard{
	constructor(ch,epc,time,antena,freq)
	{
		this.epc=epc;
		this.id=epc.subarray(8,12);
		this.time=[]
		this.time[ch]=time;
		this.antena=[]
		this.antena[ch]=antena;
		this.freq=[]
		this.freq[ch]=freq
		this.cnt=[]
		this.cntPass=[]
		this.status=[]
		this.prevStatus=[]
	}
	init()
	{
		for(let i=0;i<countReader;i++)
		{
			this.time[i]=0
			this.antena[i]=0
			this.freq[i]=0
			this.cnt[i]=0
			this.cntPass[i]=0
			this.status[i]=0
			this.prevStatus[i]=0
		}
	}
}
var List=[]
function getIndex(list,val)
{
	var res=-1
	for(let i=0;i<list.length;i++)
	{
		var cmp=Buffer.compare(list[i].epc,val)
		if (cmp == 0)
		{
			res=i;
			break;
		}
	}
	return res;
}

function parse(dataIn,ch)
{
	if(dataIn[0]!=0xA0)return;
	if(dataIn[3]==0x89||dataIn[3]==0x8A)
	{
		dat=packetUtils.arrayToByte(dataIn,4);
		var time=Date.now()
		var freq=(dat>>2)&0x03F
		var ant=(dat&0x03)+1
		var id=dataIn.subarray(7,19)
		listCardActive =new ListCard(ch,id,time,ant,freq);
		listCardActive.init()
		var idx=getIndex(List,id)
		if (idx === -1)List.push(listCardActive)
		else
		{
			 List[idx].cnt[ch]++
			 List[idx].time[ch]=time;
		 }

	}
}

function checkEpcIdExists(dobArraySearchStrings, epcId) {
    for (let i = 0; i < dobArraySearchStrings.length; i++) {
        const sublist = dobArraySearchStrings[i];
        if (sublist.includes(epcId)) {
            return true;
        }
    }
    return false;
}

function findParticipantId(array, epcId) {
	for (let i = 0; i < array.length; i++) {
	  if (array[i][1] === epcId) {
		return array[i][0];
	  }
	}
	return null;
  }
  
  function findChipId(array, epcId) {
	for (let i = 0; i < array.length; i++) {
	  if (array[i][1] === epcId) {
		return array[i][1];
	  }
	}
	return null;
  }
  
  function findIdchip(array, epcId) {
	for (let i = 0; i < array.length; i++) {
	  if (array[i][1] === epcId) {
		return array[i][2];
	  }
	}
	return null;
  }

function sendMQTT(i,j)
{
	console.log('MQTT '+(j+1)+ ' '+packetUtils.dumpData(List[i].epc)+' '+List[i].cntPass[j])
	var epcId = packetUtils.dumpData(List[i].epc);
	var countPass = List[i].cntPass[j];
	var reader = (j+1)
	const result = checkEpcIdExists(dobArraySearchStrings, epcId);
	//console.log("Print Value Array MQTT: ", dobArraySearchStrings );
	//console.log('From Reader :', reader )
	//console.log('EPCID :', epcId )
	//console.log('Count Pass :', countPass )
	console.log('Print Result Check EPC :', result);
	if (result) {
		const participantId = findParticipantId(dobArraySearchStrings, epcId);
		const chipId = findChipId(dobArraySearchStrings, epcId);
		const Idchip = findIdchip(dobArraySearchStrings, epcId);
		console.log("Print Participant Id: ", participantId);
		console.log("Print Chip Id: ", chipId);
		console.log("Print Idchip:", Idchip);
		clientmqtt.publish(`chip/${Idchip}/${participantId}`, reader.toString(), function (err) {
			if (err) {
			  console.log(err);
			}
		  });
	  } else {
		console.log("Print false or no data match ");
	  }
}
for (let i=0;i<countReader;i++)
{
client[i].connect({ port: port[i], host: host[i] }, ()=> {
	client[i].on('data', (chunk)=> {
//		console.log('recv:'+dump(chunk));
		parse(chunk,i)
	});
})
} 
setInterval(()=>{
	cmd_fast_switch_ant_inventory()
		//cmd_real_time_inventory();
},1000)

setInterval(()=>{
	var now=Date.now()

	for(var i=0;i<List.length;i++)
	{
		for(let j=0;j<countReader;j++)
		{
			if(List[i].time[j]+activeTimeout>now){
				List[i].status[j]=1
				if(List[i].prevStatus[j] === 0)
				{
					List[i].cntPass[j]++;
					sendMQTT(i,j)
				}
			}
			else List[i].status[j]=0
			List[i].prevStatus[j]=List[i].status[j]
		}

		var data=""
		for(let j=0;j<countReader;j++)
		{
			data+=' ch'+(j+1)+' '+List[i].cnt[j]+' '+List[i].cntPass[j]+' '+List[i].status[j]
		}
		//console.log(packetUtils.dumpData(List[i].epc)+data)
		
	}

},1000);
