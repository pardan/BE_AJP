function arrayToByte(buff,i){
	return buff[i]
}
function arrayToShort(buff,i){
	var temp=buff[i+1]
	temp<<=8;
	temp+=buff[i]
	return temp
}

function arrayToWord(buff,i){
	var temp
	temp=buff[i+3];temp<<=8;
	temp+=buff[i+2];temp<<=8;
	temp+=buff[i+1];temp<<=8;
	temp+=buff[i]
	return temp
}
function arrayToLong(buff,i){
	var temp
	temp=buff[i+7];temp<<=8;
	temp=buff[i+6];temp<<=8;
	temp+=buff[i+5];temp<<=8;
	temp+=buff[i+4];temp<<=8;
	temp=buff[i+3];temp<<=8;
	temp+=buff[i+2];temp<<=8;
	temp+=buff[i+1];temp<<=8;
	temp+=buff[i]
	return temp
}
function arrayToFloat(buff,i){
	var temp=new ArrayBuffer(4)
	var vw=new DataView(temp)
	temp[0]=4
	return vw.getFloat32(0)
}

function checksum(pkt,len)
{
    let res=0;
    let val=0;
    for(let i=0;i<len;i++)
    {
        val+=pkt[i];res=~val+1&0xFF;
		//console.log(','+pkt[i].toString(16).toUpperCase()+' '+res.toString(16).toUpperCase());
    }
    return res;
}
function dump(data)
{
	var str='';
	for(let i=0;i<data.length;i++)
	{
		if(data[i]<0x10)str+='0'+data[i].toString(16).toUpperCase()+' ';
		else str+=data[i].toString(16).toUpperCase()+' ';
	}
	return str
}

function dumpData(data)
{
	var str='';
	for(let i=0;i<data.length;i++)
	{
		if(data[i]<0x10)str+='0'+data[i].toString(16).toUpperCase();
		else str+=data[i].toString(16).toUpperCase();
	}
	return str
}

exports.arrayToLong=arrayToLong
exports.arrayToByte=arrayToByte
exports.arrayToShort=arrayToShort
exports.arrayToFloat=arrayToFloat
exports.dump=dump
exports.dumpData=dumpData
exports.checksum=checksum
