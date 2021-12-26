import { Contract, ethers } from 'ethers';

export const buildBytecode = (
  constructorTypes: any[],
  constructorArgs: any[],
  contractBytecode: string,
) =>
  `${contractBytecode}${encodeParams(constructorTypes, constructorArgs).slice(
    2,
  )}`

export const buildCreate2Address = (factoryAddress: string, saltHex: string, byteCode: string) => {
  return `0x${ethers.utils
    .keccak256(
      `0x${['ff', factoryAddress, saltHex, ethers.utils.keccak256(byteCode)]
        .map((x) => x.replace(/0x/, ''))
        .join('')}`,
    )
    .slice(-40)}`.toLowerCase()
}

export const saltToHex = (salt: string | number) =>
  ethers.utils.id(salt.toString())

export const encodeParams = (dataTypes: any[], data: any[]) => {
  const abiCoder = ethers.utils.defaultAbiCoder
  return abiCoder.encode(dataTypes, data)
}

/**
 * Deploy contract using create2.
 *
 * Deploy an arbitrary contract using a create2 factory. Can be used with an ethers provider on any network.
 *
 */
 export async function deployContract({
  salt,
  factory,
  contractBytecode,
  constructorTypes = [] as string[],
  constructorArgs = [] as any[],
}: {
  salt: string | number
  factory: Contract
  contractBytecode: string
  constructorTypes?: string[]
  constructorArgs?: any[]
}) {
  const saltHex = saltToHex(salt)

  const bytecode = buildBytecode(
    constructorTypes,
    constructorArgs,
    contractBytecode,
  )

  const address = getCreate2Address({
    factoryAddress: factory.address,
    salt,
    contractBytecode,
    constructorTypes,
    constructorArgs
  });

  let txPromise = factory.deploy(bytecode, saltHex);
  const tx = await txPromise;
  const txHash = tx.hash;

  return { address, txHash, deployTransaction: tx };
}

/**
 * Calculate create2 address of a contract.
 *
 * Calculates deterministic create2 address locally.
 *
 */
export function getCreate2Address({
  factoryAddress,
  salt,
  contractBytecode,
  constructorTypes = [] as string[],
  constructorArgs = [] as any[],
}: {
  factoryAddress: string
  salt: string | number
  contractBytecode: string
  constructorTypes?: string[]
  constructorArgs?: any[]
}) {
  return buildCreate2Address(
    factoryAddress,
    saltToHex(salt),
    buildBytecode(constructorTypes, constructorArgs, contractBytecode),
  )
}