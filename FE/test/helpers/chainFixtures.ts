import { encodeAbiParameters, encodeEventTopics, type Abi, type AbiEvent, type Log } from 'viem';

let logCounter = 0;

/**
 * A realistic decoded-event-shaped log: real ABI-encoded topics/data, built
 * the same way viem's own parseEventLogs (the code under test) expects to
 * decode them -- indexed args hashed into topics via viem's own
 * encodeEventTopics, non-indexed args ABI-encoded into `data` via viem's own
 * encodeAbiParameters. (viem 2.28 doesn't ship an `encodeEventLog` helper,
 * so this reproduces it from the two primitives it would otherwise compose.)
 * Good enough to exercise the real decoding path in lib/chainVerify.ts end
 * to end, without a live chain.
 */
export function buildLog(params: {
  address: `0x${string}`;
  abi: Abi;
  eventName: string;
  args: Record<string, unknown>;
}): Log {
  const eventAbi = params.abi.find(
    (item): item is AbiEvent => item.type === 'event' && item.name === params.eventName
  );
  if (!eventAbi) throw new Error(`event ${params.eventName} not found in abi`);

  const topics = encodeEventTopics({ abi: params.abi, eventName: params.eventName, args: params.args } as never);
  const nonIndexedInputs = eventAbi.inputs.filter((input) => !input.indexed);
  const data =
    nonIndexedInputs.length > 0
      ? encodeAbiParameters(
          nonIndexedInputs,
          nonIndexedInputs.map((input) => params.args[input.name!])
        )
      : '0x';
  logCounter += 1;
  return {
    address: params.address,
    topics,
    data,
    blockHash: `0x${'11'.repeat(32)}` as `0x${string}`,
    blockNumber: 1n,
    transactionHash: `0x${'22'.repeat(32)}` as `0x${string}`,
    transactionIndex: 0,
    logIndex: logCounter,
    removed: false,
  } as unknown as Log;
}

export function buildReceipt(logs: Log[], status: 'success' | 'reverted' = 'success') {
  return {
    status,
    logs,
    transactionHash: `0x${'22'.repeat(32)}` as `0x${string}`,
    blockNumber: 1n,
    blockHash: `0x${'11'.repeat(32)}` as `0x${string}`,
  };
}

export const ADDR = {
  escrow: '0x1000000000000000000000000000000000000001' as `0x${string}`,
  otherEscrow: '0x1000000000000000000000000000000000000099' as `0x${string}`,
  creator: '0x2000000000000000000000000000000000000001' as `0x${string}`,
  opponent: '0x2000000000000000000000000000000000000002' as `0x${string}`,
  stakeToken: '0x3000000000000000000000000000000000000001' as `0x${string}`,
  factory: '0x4000000000000000000000000000000000000001' as `0x${string}`,
};
