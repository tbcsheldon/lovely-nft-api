// Javascript goes here
import moment from 'moment';
import axios from 'axios';
import fs from 'fs';
import * as path from 'path';
import * as csv from '@fast-csv/format';

console.log('up to zero!');

class CsvFile {
    static write(filestream, rows, options) {
        return new Promise((res, rej) => {
            csv.writeToStream(filestream, rows, options)
                .on('error', err => rej(err))
                .on('finish', () => res());
        });
    }

    constructor(opts) {
        this.headers = opts.headers;
        this.path = opts.path;
        this.writeOpts = { headers: this.headers, includeEndRowDelimiter: true };
    }

    create(rows) {
        return CsvFile.write(fs.createWriteStream(this.path), rows, { ...this.writeOpts });
    }

    append(rows) {
        return CsvFile.write(fs.createWriteStream(this.path, { flags: 'a' }), rows, {
            ...this.writeOpts,
            // dont write the headers when appending
            writeHeaders: false,
        });
    }

    read() {
        return new Promise((res, rej) => {
            fs.readFile(this.path, (err, contents) => {
                if (err) {
                    return rej(err);
                }
                return res(contents);
            });
        });
    }
}

const delay = time => new Promise(res=>setTimeout(res,time));

function useMoment(date) {
    var date = moment(date).format("x");
    return date;
    // console.log(date)
}

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const loopringAPI = async (url) => {
    //fetch to generate droplet info
    let options = {
        method: 'GET',
        url: url,
        headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': 'VTvs3tvQXoQaJotMMvAiEeIkGeluxP2CHLX8XHyv6veKnCzqvHnKCXybVm3R4scW',
        },
    };
    
    const response = await axios(options).then(function (response) { return response.data })
    return response;
}

async function init() {
    let url = "https://api3.loopring.io/api/v3/user/nft/mints?accountId=125722&&txStatus='processed'&limit=30"

    const mintHistory = await loopringAPI(url)
    let mintTotal = parseInt(mintHistory.totalNum / 30);
    console.log(mintHistory.totalNum);
    let mints = [mintHistory.mints];
    var lastTimeStamp = moment(mints[0][mints[0].length - 1].createdAt).format("x");
    let count = mints[0].length;
    let mintPageURL;

    console.log(lastTimeStamp);

    for await (const variable of Array.from(Array(mintTotal).keys())) {
        let mintPageURL = url + "&end="+lastTimeStamp
        const res = await loopringAPI(mintPageURL)
        mints.push(res.mints)
        count = count + res.mints.length
        lastTimeStamp = moment(res.mints[res.mints.length - 1].createdAt).format("x");
    }

    // console.log(mints.slice(0,2));


    let nftIDs = [""];
    let nftDatas = ["walletAddress"];
    for await (const mint of mints) {

        let currentMints = mint.map(m => { return m.nftData })
        let nftIdAPIUrl = "https://api3.loopring.io/api/v3/nft/info/nfts?nftDatas="+currentMints.join(",")
        let nftIdAPIresponse = await loopringAPI(nftIdAPIUrl);

        nftIDs.push(...nftIdAPIresponse.map(nft => { return nft.nftId }))
        nftDatas.push(...nftIdAPIresponse.map(nft => { return nft.nftData }))
        // console.log(nftIDs.length);
    }

    let walletsIDs = []
    for await (const nftData of nftDatas) {
        if(nftData != 'walletAddress') {
            let nftHoldersAPIurl = "https://api3.loopring.io/api/v3/nft/info/nftHolders?nftData="+nftData
            let nftHoldersAPIresponse = await loopringAPI(nftHoldersAPIurl);
            
            
            // for( ii=0; ii < nftHoldersAPIresponse.nftHolders.length; ii++) {
            for await (const nftHolder of nftHoldersAPIresponse.nftHolders) {
                if(!walletsIDs.includes(nftHolder.accountId)) {
                    console.log("Found new holding account: %s", nftHolder.accountId);
                    walletsIDs.push(nftHolder.accountId)
                    
                }
            }
        }
    }

    let accountRows = [];
    for await (const walletID of walletsIDs) {
        console.log(walletID);

        let walletAddressAPIURL = "https://api3.loopring.io/api/v3/account?accountId="+walletID
        let walletAddressAPIresponse = await loopringAPI(walletAddressAPIURL);

        let accountRow = {
            walletAddress: walletAddressAPIresponse.owner
        }
        let nftBalanceCheckAPIresponse, ownedNFTs = []
        for await (const mint of mints) {
            let currentMints = mint.map(m => { return m.nftData })
            let nftBalanceCheckURL = "https://api3.loopring.io/api/v3/user/nft/balances?accountId="+walletID+"&nonZero=false&limit=30&nftDatas="+currentMints.join(",")
            nftBalanceCheckAPIresponse = await loopringAPI(nftBalanceCheckURL);
            if(nftBalanceCheckAPIresponse.totalNum > 0) {
                ownedNFTs.push(...nftBalanceCheckAPIresponse.data);
            }
            // accountRow[`${nftBalanceCheckAPIresponse.data.nftId}`] = parseInt(nftBalanceCheckAPIresponse.totalNum)
            await delay(300);
        }
        accountRow.ownedNFTs = ownedNFTs.map(nft => { return { total: nft.total, nftData: nft.nftData } });
        accountRow.totalNum = ownedNFTs.length;
        accountRows.push(accountRow)
        console.log("owned: ", ownedNFTs);
    }

    // console.log(accountRows[0]);



    const csvFile = new CsvFile({
        path: 'append.tmp.csv',
        // headers to write
        headers: [...nftDatas],
    });

    let csvRows = []
    for await (const accountRow of accountRows) {
        let csvRow = { walletAddress: accountRow.walletAddress }
        for await (const nftData of nftDatas) {
            if(nftData != "walletAddress") {
                let currentCount = 0;
                for await (const ownedNFT of accountRow.ownedNFTs) {
                    if(ownedNFT.nftData == nftData) {
                        currentCount = ownedNFT.total
                    }
                }
                csvRow[nftData] = currentCount.toString()
            }
        }
        csvRows.push(csvRow)
    }
    
    csvFile
        .create(csvRows)
        .then(() => csvFile.read())
        .then(contents => {
            console.log(`${contents}`);
        })
        .catch(err => {
            console.error(err.stack);
            process.exit(1);
        });
}

init();
