"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ethers } from "ethers";


const QrReader = dynamic(() => import("react-qr-reader"), { ssr: false });


const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:3000";
const STAMPCARD_ADDRESS = process.env.NEXT_PUBLIC_STAMPCARD_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);


const domain = { name: "StampCard", version: "1", chainId: CHAIN_ID, verifyingContract: STAMPCARD_ADDRESS } as const;
const types = { StampRequest: [
{ name: "cafeId", type: "bytes16" },
{ name: "nonce", type: "bytes32" },
{ name: "expires", type: "uint256" },
{ name: "customer", type: "address" }
]} as const;


function loadPriv(): string | null { return localStorage.getItem("customer_priv") }
function savePriv(pk: string) { localStorage.setItem("customer_priv", pk) }


export default function Customer() {
const [wallet, setWallet] = useState<ethers.Wallet | null>(null);
const [addr, setAddr] = useState<string>("");
const [scanErr, setScanErr] = useState<string | null>(null);
const [message, setMessage] = useState<any>(null);
const [signing, setSigning] = useState(false);
const [result, setResult] = useState<any>(null);


useEffect(() => {
const stored = loadPriv();
if (stored) {
const w = new ethers.Wallet(stored);
setWallet(w); setAddr(w.address);
}
}, []);


function createWallet() {
const w = ethers.Wallet.createRandom();
savePriv(w.privateKey);
setWallet(w); setAddr(w.address);
}


async function onScan(data: string | null) {
if (!data) return;
try {
const parsed = JSON.parse(data);
if (parsed?.type !== "STAMP_REQUEST") return;
setMessage(parsed);
} catch (e) { setScanErr(String(e)); }
}


async function signAndSend() {
if (!wallet || !message) return;
setSigning(true);
try {
const payload = {
cafeId: message.cafeId,
}