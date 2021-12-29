import type { HardhatRuntimeEnvironment } from 'hardhat/types';
import type { ContractFactory, Contract } from 'ethers';

import { Manifest, fetchOrDeployAdmin, logWarning, ProxyDeployment, Deployment } from '@openzeppelin/upgrades-core';

import {
  DeployProxyOptions,
  deploy,
  getProxyFactory,
  getTransparentUpgradeableProxyFactory,
  getProxyAdminFactory,
  DeployTransaction,
  BeaconProxyUnsupportedError,
  deployProxyImpl,
  getInitializerData,
} from './utils';
import { deployContract, getCreate2Address } from './utils/create2-deployer';

export interface DeployFunction {
  (ImplFactory: ContractFactory, args?: unknown[], opts?: DeployProxyOptions): Promise<Contract>;
  (ImplFactory: ContractFactory, opts?: DeployProxyOptions): Promise<Contract>;
}

export function makeDeployProxy(hre: HardhatRuntimeEnvironment): DeployFunction {
  return async function deployProxy(
    ImplFactory: ContractFactory,
    args: unknown[] | DeployProxyOptions = [],
    opts: DeployProxyOptions = {},
  ) {
    if (!Array.isArray(args)) {
      opts = args;
      args = [];
    }

    const { provider } = hre.network;
    const manifest = await Manifest.forNetwork(provider);

    let impl: string = '';
    let kind: string = '';

    if (opts.deployFactory !== undefined && opts.deployFactorySalt !== undefined) {
      kind = opts.kind ?? 'uups';
      const bytecode = ImplFactory.bytecode;

      let contractAddress = await getCreate2Address({
        factoryAddress: opts.deployFactory.address,
        salt: opts.deployFactorySalt,
        contractBytecode: bytecode,
        constructorTypes: [],
        constructorArgs: []
      });

      let contractDeployment = Object.assign({ kind }, await deployContract({
          salt: opts.deployFactorySalt,
          factory: opts.deployFactory,
          contractBytecode: bytecode,
          constructorTypes: [],
          constructorArgs: []
        }));

        await contractDeployment.deployTransaction.wait();

      impl = contractAddress;
      
    } else {
      const deployedImpl = await deployProxyImpl(hre, ImplFactory, opts);
      impl = deployedImpl.impl;
      kind = deployedImpl.kind;  
    }

    const contractInterface = ImplFactory.interface;
    const data = getInitializerData(contractInterface, args, opts.initializer);

    if (kind === 'uups') {
      if (await manifest.getAdmin()) {
        logWarning(`A proxy admin was previously deployed on this network`, [
          `This is not natively used with the current kind of proxy ('uups').`,
          `Changes to the admin will have no effect on this new proxy.`,
        ]);
      }
    }

    let proxyDeployment: { kind: string } & Required<Deployment & DeployTransaction>;
    let ProxyFactory: ContractFactory;
    let proxyFactoryArgs: any[] = [];
    let proxyFactoryConstructorArgTypes: any[] = [];
    switch (kind) {
      case 'beacon': {
        throw new BeaconProxyUnsupportedError();
      }

      case 'uups': {
        ProxyFactory = await getProxyFactory(hre, ImplFactory.signer);
        proxyFactoryArgs = [impl, data];
        proxyFactoryConstructorArgTypes = ["address", "bytes"];
        break;
      }

      case 'transparent': {
        const AdminFactory = await getProxyAdminFactory(hre, ImplFactory.signer);
        const adminAddress = await fetchOrDeployAdmin(provider, () => deploy(AdminFactory));
        ProxyFactory = await getTransparentUpgradeableProxyFactory(hre, ImplFactory.signer);
        proxyFactoryArgs = [impl, adminAddress, data];
        proxyFactoryConstructorArgTypes = ["address", "address", "bytes"];
        break;
      }
    }

    if (opts.deployFactory === undefined || opts.deployFactorySalt === undefined) {
      proxyDeployment = Object.assign(
        { kind },
        // @ts-ignore
        await deploy(ProxyFactory, ...proxyFactoryArgs),
      );
    } else {
      // @ts-ignore
      const bytecode = ProxyFactory.bytecode;

      proxyDeployment = Object.assign({ kind }, await deployContract({
        salt: opts.deployFactorySalt,
        factory: opts.deployFactory,
        contractBytecode: bytecode,
        constructorTypes: proxyFactoryConstructorArgTypes,
        constructorArgs: proxyFactoryArgs
      }));
    }

    await manifest.addProxy(proxyDeployment as ProxyDeployment);

    const inst = ImplFactory.attach(proxyDeployment.address);
    // @ts-ignore Won't be readonly because inst was created through attach.
    inst.deployTransaction = proxyDeployment.deployTransaction;
    return inst;
  };
}

