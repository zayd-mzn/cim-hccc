const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('AgentEscrow', () => {
  const jobId = ethers.id('job-1');
  const hash = ethers.id('result');
  let token, escrow, consumer, provider, other, deadline;

  beforeEach(async () => {
    [, consumer, provider, other] = await ethers.getSigners();
    token = await (await ethers.getContractFactory('MockToken')).deploy();
    escrow = await (await ethers.getContractFactory('AgentEscrow')).deploy(await token.getAddress());
    await token.mint(consumer.address, 1000);
    await token.connect(consumer).approve(await escrow.getAddress(), 1000);
    deadline = (await time.latest()) + 3600;
  });

  it('holds funds on fund()', async () => {
    await expect(escrow.connect(consumer).fund(jobId, provider.address, 100, deadline))
      .to.emit(escrow, 'JobFunded').withArgs(jobId, consumer.address, provider.address, 100, deadline);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(100);
    expect(await token.balanceOf(consumer.address)).to.equal(900);
  });

  it('releases to provider on delivery hash', async () => {
    await escrow.connect(consumer).fund(jobId, provider.address, 100, deadline);
    await expect(escrow.connect(provider).deliver(jobId, hash))
      .to.emit(escrow, 'JobReleased').withArgs(jobId, provider.address, 100, hash);
    expect(await token.balanceOf(provider.address)).to.equal(100);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0);
  });

  it('only the provider can deliver', async () => {
    await escrow.connect(consumer).fund(jobId, provider.address, 100, deadline);
    await expect(escrow.connect(other).deliver(jobId, hash)).to.be.revertedWith('only provider');
  });

  it('refunds only after the deadline, only to the consumer', async () => {
    await escrow.connect(consumer).fund(jobId, provider.address, 100, deadline);
    await expect(escrow.connect(consumer).refund(jobId)).to.be.revertedWith('deadline not passed');
    await time.increaseTo(deadline + 1);
    await expect(escrow.connect(other).refund(jobId)).to.be.revertedWith('only consumer');
    await expect(escrow.connect(consumer).refund(jobId)).to.emit(escrow, 'JobRefunded');
    expect(await token.balanceOf(consumer.address)).to.equal(1000);
  });

  it('cannot double-spend: no deliver after refund, no refund after deliver, no re-fund', async () => {
    await escrow.connect(consumer).fund(jobId, provider.address, 100, deadline);
    await escrow.connect(provider).deliver(jobId, hash);
    await time.increaseTo(deadline + 1);
    await expect(escrow.connect(consumer).refund(jobId)).to.be.revertedWith('not held');
    await expect(escrow.connect(provider).deliver(jobId, hash)).to.be.revertedWith('not held');
    await expect(escrow.connect(consumer).fund(jobId, provider.address, 100, deadline + 100)).to.be.revertedWith('job exists');
  });

  it('rejects bad input', async () => {
    await expect(escrow.connect(consumer).fund(jobId, provider.address, 0, deadline)).to.be.revertedWith('amount=0');
    await expect(escrow.connect(consumer).fund(jobId, consumer.address, 1, deadline)).to.be.revertedWith('bad provider');
    await expect(escrow.connect(consumer).fund(jobId, provider.address, 1, 1)).to.be.revertedWith('deadline in past');
  });
});
