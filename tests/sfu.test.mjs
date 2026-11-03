import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSfu } from '../server/sfu.mjs';
import { MAX_PARTICIPANTS, MAX_ROOM_MEDIA_STREAMS } from '../shared/meeting-limits.js';

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
  process.env.ROOM_MAX_MEDIA_STREAMS = String(MAX_ROOM_MEDIA_STREAMS);
  const sfu = await createSfu(() => {});
  const request = (user, method, data) => sfu.request('capacity-test', user, method, data);
  try {
    const participants = await Promise.all(Array.from({ length: MAX_PARTICIPANTS }, async (_, index) => {
      const user = `user-${index + 1}`;
      const transport = await request(user, 'createTransport', { direction: 'send' });
      return { user, transportId: transport.id, index };
    }));
    const media = participants.flatMap(({ user, transportId, index }) => [
      { user, transportId, source: 'audio', kind: 'audio', ssrc: 500000 + index * 3 },
      { user, transportId, source: 'video', kind: 'video', ssrc: 500001 + index * 3 },
      { user, transportId, source: 'screen', kind: 'video', ssrc: 500002 + index * 3 },
    ]);
    const published = await Promise.all(media.map(({ user, transportId, source, kind, ssrc }) => request(user, 'produce', {
      transportId, kind, source,
      rtpParameters: {
        codecs: kind === 'audio'
          ? [{ mimeType: 'audio/opus', payloadType: 100, clockRate: 48000, channels: 2, parameters: { useinbandfec: 1 }, rtcpFeedback: [] }]
          : [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000, rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }] }],
        encodings: [{ ssrc }], rtcp: { cname: `capacity-${ssrc}` },
      },
    })));
    assert.equal(published.length, MAX_ROOM_MEDIA_STREAMS);

    const overflowUser = 'user-overflow';
    const overflowTransport = await request(overflowUser, 'createTransport', { direction: 'send' });
    await assert.rejects(
      request(overflowUser, 'produce', {
        transportId: overflowTransport.id, kind: 'audio', source: 'audio',
        rtpParameters: {
          codecs: [{ mimeType: 'audio/opus', payloadType: 100, clockRate: 48000, channels: 2, parameters: { useinbandfec: 1 }, rtcpFeedback: [] }],
          encodings: [{ ssrc: 600001 }], rtcp: { cname: 'capacity-overflow' },
        },
      }),
      /媒体流上限/,
    );
    await request(participants[0].user, 'closeProducer', { producerId: published[0].id });
    const replacement = await request(overflowUser, 'produce', {
      transportId: overflowTransport.id, kind: 'audio', source: 'audio',
      rtpParameters: {
        codecs: [{ mimeType: 'audio/opus', payloadType: 100, clockRate: 48000, channels: 2, parameters: { useinbandfec: 1 }, rtcpFeedback: [] }],
        encodings: [{ ssrc: 600002 }], rtcp: { cname: 'capacity-replacement' },
      },
    });
    assert.ok(replacement.id);
  } finally {
    sfu.close();
    if (previousCap === undefined) delete process.env.ROOM_MAX_MEDIA_STREAMS;
    else process.env.ROOM_MAX_MEDIA_STREAMS = previousCap;
  }
});
