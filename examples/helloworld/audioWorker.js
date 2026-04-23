import Resource from "Resource";
import AudioOut from "pins/audioout";

self.onmessage = function(message) {
    trace(message, "\n");
    let bonfire = new Resource("Bonfire.maud");
    let audio = new AudioOut({sampleRate: 32000, bitsPerSample: 16, numChannels: 1, streams: 1});
    audio.enqueue(0, AudioOut.Samples, bonfire, 2);
    audio.start();
}
