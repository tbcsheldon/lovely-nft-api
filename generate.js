require('dotenv').config();
import moment from 'moment';
import axios from 'axios';
import CsvFile from './lib/csv.js'
import BN from "bn.js";
const CID = require("cids");

const delay = time => new Promise(res=>setTimeout(res,time));

const ipfsNftIDToCid = (nftId) => {
    const hashBN = new BN(nftId.replace("0x", ""), 16);
    const hex = hashBN.toString(16, 64);
    const buf = Buffer.from("1220" + hex, "hex");
    const cid = new CID(buf);
    return cid.toString();
}
const pinataApi = async (CID) => {
    let options = {
        method: 'GET',
        url: `https://loopring.mypinata.cloud/ipfs/${CID}`,
        headers: {
            'Content-Type': 'application/json',
        },
    };
    
    const response = await axios(options).then(function (response) { return response.data })
    return response;
}

const loopringAPI = async (url) => {
    let options = {
        method: 'GET',
        url: url,
        headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': process.env.LOOPRING_API_KEY,
        },
    };
    
    const response = await axios(options).then(function (response) { return response.data })
    return response;
}

async function init() {
    
    let url = "https://api3.loopring.io/api/v3/user/nft/mints?accountId="+process.env.LOOPRING_ACCOUNT_ID+"&&txStatus='processed'&limit=30"

    const mintHistory = await loopringAPI(url)
    let mintTotal = parseInt(mintHistory.totalNum / 30);
    let mints = [mintHistory.mints];
    var lastTimeStamp = moment(mints[0][mints[0].length - 1].createdAt).format("x");
    let count = mints[0].length;
    let mintPageURL;

    console.log("This may take a while please be patient.");
    console.log("Fetch mint history...");

    for await (const variable of Array.from(Array(mintTotal).keys())) {
        let mintPageURL = url + "&end="+lastTimeStamp
        const res = await loopringAPI(mintPageURL)
        mints.push(res.mints)
        count = count + res.mints.length
        lastTimeStamp = moment(res.mints[res.mints.length - 1].createdAt).format("x");
    }

    let nftIDs = ["walletAddress"];
    let nftDatas = ["walletAddress"];
    for await (const mint of mints) {

        let currentMints = mint.map(m => { return m.nftData })
        let nftIdAPIUrl = "https://api3.loopring.io/api/v3/nft/info/nfts?nftDatas="+currentMints.join(",")
        let nftIdAPIresponse = await loopringAPI(nftIdAPIUrl);

        nftIDs.push(...nftIdAPIresponse.map(nft => { return nft.nftId }))
        nftDatas.push(...nftIdAPIresponse.map(nft => { return nft.nftData }))
    }

    let initinc = 0;
    let initcsvRow1 = { walletAddress: '' }
    let initcsvRow2 = { walletAddress: '' }
    for await (const nftData of nftDatas) {
        if(nftData != "walletAddress") {
            let finalcid = ipfsNftIDToCid(nftIDs[initinc]);
            let metatadata = await pinataApi(finalcid);
            let image = metatadata.image.replace("ipfs://", "https://loopring.mypinata.cloud/ipfs/")
            initcsvRow1[nftIDs[initinc]] = metatadata.name;
            initcsvRow2[nftIDs[initinc]] = '=IMAGE("'+image+'")';
            console.clear();
            console.log("Found NFT: "+metatadata.name)
            await delay(500);
        }
        initinc++
    }

    console.log("Fetch NFT holders...");
    let walletsIDs = []
    for await (const nftData of nftDatas) {
        if(nftData != 'walletAddress') {
            let nftHoldersAPIurl = "https://api3.loopring.io/api/v3/nft/info/nftHolders?nftData="+nftData
            let nftHoldersAPIresponse = await loopringAPI(nftHoldersAPIurl);
            
            for await (const nftHolder of nftHoldersAPIresponse.nftHolders) {
                if(!walletsIDs.includes(nftHolder.accountId)) {
                    console.clear();
                    console.log("Found new holding account: %s", nftHolder.accountId);
                    walletsIDs.push(nftHolder.accountId)
                }
            }
        }
    }

    let accountRows = [];
    let ii = 1;
    for await (const walletID of walletsIDs) {
        console.clear();
        console.log("Aggregate NFT holder data, please be patient..."+ii+" of "+walletsIDs.length);
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
            await delay(100);
        }
        accountRow.ownedNFTs = ownedNFTs.map(nft => { return { total: nft.total, nftData: nft.nftData } });
        accountRow.totalNum = ownedNFTs.length;
        accountRows.push(accountRow)
        ii++
    }

    console.log("Write CSV File...");
    let csvFileName = 'nft-report-'+process.env.LOOPRING_ACCOUNT_ID+'-'+moment().format("x")
    const csvFile = new CsvFile({
        path: 'reports/'+csvFileName+'.csv',
        headers: [...nftIDs],
    });

    let csvRows = [initcsvRow1, initcsvRow2]

    for await (const accountRow of accountRows) {
        let inc = 0;
        let csvRow = { walletAddress: accountRow.walletAddress }
        for await (const nftData of nftDatas) {
            if(nftData != "walletAddress") {
                let currentCount = 0;
                for await (const ownedNFT of accountRow.ownedNFTs) {
                    if(ownedNFT.nftData == nftData) {
                        currentCount = ownedNFT.total
                    }
                }
                csvRow[nftIDs[inc]] = currentCount.toString()
            }
            inc++
        }
        csvRows.push(csvRow)
        
    }
    
    csvFile
        .create(csvRows)
        .then(() => csvFile.read())
        .then(contents => {
            console.log(`Complete! Total NFTs minted: ${nftDatas.length}. Total NFT holders: ${accountRows.length}.`);
        })
        .catch(err => {
            console.error(err.stack);
            process.exit(1);
        });
}

init();
