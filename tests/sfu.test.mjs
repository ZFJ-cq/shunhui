import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSfu } from '../server/sfu.mjs';

test('real SFU screen publish, subscribe, resume and repeated close', { skip: process.env.REAL_SFU !== '1' }, async () => {
  const events = [];
  const sfu = await createSfu((room, type, payload, target) => events.push({ room, type, payload, target }));
  const request = (user, method, data) => sfu.request('screen-test', user, method, data);
  try {
    const capabilities = await request('host', 'capabilities');
    const send = await request('host', 'createTransport', { direction: 'send' });
    const recv = await request('viewer', 'createTransport', { direction: 'recv' });
    for (let round = 0; round < 2; round++) {
      const producer = await request('host', 'produce', {
        transportId: send.id, kind: 'video', source: 'screen',
        rtpParameters: {
          codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000, rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }] }],
          encodings: [{ ssrc: 111111 + round }], rtcp: { cname: 'screen-test' },
        },
      });
      const consumer = await request('viewer', 'consume', { transportId: recv.id, producerId: producer.id, rtpCapabilities: capabilities });
      assert.equal(consumer.source, 'screen');
      assert.equal(consumer.userId, 'host');
      await request('viewer', 'resumeConsumer', { consumerId: consumer.id });
      await request('viewer', 'refreshConsumer', { consumerId: consumer.id });
      assert.equal((await request('viewer', 'producers')).length, 1);
      assert.deepEqual(await request('host', 'closeProducer', { producerId: producer.id }), { source: 'screen' });
      await request('host', 'closeProducer', { producerId: producer.id });
      assert.equal((await request('viewer', 'producers')).length, 0);
      assert.equal(events.filter(e => e.type === 'producer_closed' && e.payload.id === producer.id).length, 1);
      // Worker delivers consumer closure asynchronously.
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.ok(events.some(e => e.type === 'consumer_closed' && e.payload.id === consumer.id && e.target === 'viewer'));
    }
    const producer = await request('host', 'produce', {
      transportId: send.id, kind: 'video', source: 'screen',
      rtpParameters: {
        codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000, rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }] }],
        encodings: [{ ssrc: 222222 }], rtcp: { cname: 'screen-test-close-transport' },
      },
    });
    await request('host', 'closeTransport', { transportId: send.id, direction: 'send' });
    assert.equal((await request('viewer', 'producers')).length, 0);
    assert.ok(events.some(e => e.type === 'producer_closed' && e.payload.id === producer.id));
    const replacement = await request('host', 'createTransport', { direction: 'send' });
    assert.notEqual(replacement.id, send.id);
    const camera = await request('host', 'produce', {
      transportId: replacement.id, kind: 'video', source: 'video',
      rtpParameters: {
        codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000, rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }] }],
        encodings: [{ ssrc: 333001 }, { ssrc: 333002 }, { ssrc: 333003 }], rtcp: { cname: 'camera-simulcast-test' },
      },
    });
    const cameraConsumer = await request('viewer', 'consume', { transportId: recv.id, producerId: camera.id, rtpCapabilities: capabilities, spatialLayer: 1 });
    assert.equal(cameraConsumer.source, 'video');
    await request('viewer', 'resumeConsumer', { consumerId: cameraConsumer.id });
    await request('viewer', 'setConsumerLayer', { consumerId: cameraConsumer.id, spatialLayer: 0 });
    await request('viewer', 'setConsumerLayer', { consumerId: cameraConsumer.id, spatialLayer: 2 });
  } finally { sfu.close(); }
});

test('enforces the room media stream cap and frees capacity on producer close', { skip: process.env.REAL_SFU !== '1' }, async () => {
  const previousCap = process.env.ROOM_MAX_MEDIA_STREAMS;
  process.env.ROOM_MAX_MEDIA_STREAMS = '1';
  const sfu = await createSfu(() => {});
  const request = (user, method, data) => sfu.request('capacity-test', user, method, data);
  try {
    const send = await request('one', 'createTransport', { direction: 'send' });
    const secondSend = await request('two', 'createTransport', { direction: 'send' });
    const audio = await request('one', 'produce', {
      transportId: send.id, kind: 'audio', source: 'audio',
      rtpParameters: {
        codecs: [{ mimeType: 'audio/opus', payloadType: 100, clockRate: 48000, channels: 2, parameters: { useinbandfec: 1 }, rtcpFeedback: [] }],
        encodings: [{ ssrc: 444001 }], rtcp: { cname: 'capacity-test' },
      },
    });
    await assert.rejects(
      request('two', 'produce', { transportId: secondSend.id, kind: 'audio', source: 'audio', rtpParameters: {} }),
      /媒体流上限/,
    );
    await request('one', 'closeProducer', { producerId: audio.id });
    const second = await request('two', 'produce', {
      transportId: secondSend.id, kind: 'audio', source: 'audio',
      rtpParameters: {
        codecs: [{ mimeType: 'audio/opus', payloadType: 100, clockRate: 48000, channels: 2, parameters: { useinbandfec: 1 }, rtcpFeedback: [] }],
        encodings: [{ ssrc: 444002 }], rtcp: { cname: 'capacity-test-2' },
      },
    });
    assert.ok(second.id);
  } finally {
    sfu.close();
    if (previousCap === undefined) delete process.env.ROOM_MAX_MEDIA_STREAMS;
    else process.env.ROOM_MAX_MEDIA_STREAMS = previousCap;
  }
});
