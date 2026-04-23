/*
 * Copyright (c) 2016-2017  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK.
 * 
 *   This work is licensed under the
 *       Creative Commons Attribution 4.0 International License.
 *   To view a copy of this license, visit
 *       <http://creativecommons.org/licenses/by/4.0>.
 *   or send a letter to Creative Commons, PO Box 1866,
 *   Mountain View, CA 94042, USA.
 *
 */
import LS013B4DN04 from "ls013b4dn04";
import Poco from "commodetto/Poco";
import Resource from "Resource";
import parseBMP from "commodetto/parseBMP";
import parseBMF from "commodetto/parseBMF";
import AudioOut from "pins/audioout";
// import Sleep from "sleep";
import Timer from "timer";
import Digital from "pins/digital";
import I2C from "pins/i2c";

let message = "Hello, world - sample";
trace(message + "\n");

// traces to console when FLASH button on ESP8266 NodeMCU boards is pressed.
// traces to console when IO0 button on ESP32 NodeMCU boards is pressed.

const BUTTON_PIN = 38;

let SLEEP_MS = 25; // 25;

const MAX1704X_VCELL_REG = 0x02;
const MAX1704X_SOC_REG = 0x04;
const MAX1704X_MODE_REG = 0x06;
const MAX1704X_VERSION_REG = 0x08;
const MAX1704X_HIBRT_REG = 0x0A;
const MAX1704X_CONFIG_REG = 0x0C;
const MAX1704X_VALERT_REG = 0x14;
const MAX1704X_CRATE_REG = 0x16;
const MAX1704X_VRESET_REG = 0x18;
const MAX1704X_CHIPID_REG = 0x19;
const MAX1704X_STATUS_REG = 0x1A;
const MAX1704X_CMD_REG = 0xFE;

const ALERTFLAG_SOC_CHANGE = 0x20;
const ALERTFLAG_SOC_LOW = 0x10;
const ALERTFLAG_VOLTAGE_RESET = 0x08;
const ALERTFLAG_VOLTAGE_LOW = 0x04;
const ALERTFLAG_VOLTAGE_HIGH = 0x02;
const ALERTFLAG_RESET_INDICATOR = 0x01;

const FREQUENCY = 1600; // Hz
const PERIOD = 1 / FREQUENCY; // seconds

// aPlus, aMinus, bPlus, bMinus
function generateStepperPWM(t) {
    // Base signals (sine waves shifted by 90 degrees)
    return [
        Math.sin(2 * Math.PI * PERIOD * t),
        Math.sin(2 * Math.PI * PERIOD * t + Math.PI),
        Math.sin(2 * Math.PI * PERIOD * t + Math.PI / 2),
        Math.sin(2 * Math.PI * PERIOD * t + 3 * Math.PI / 2)
    ].map(v => v > 0 ? v : 0); // Convert sine waves to PWM (0 to 1 range)
}

export default function () {
    trace('Starting...');
    Timer.set(() => {
        Digital.write(4, 1);
    }, 10);
    trace(`Using pin ${BUTTON_PIN} for button.\n`);

    const button = new Digital(BUTTON_PIN, Digital.InputPullUp);
    const width = 400, height = 240;
    let render = new Poco(new LS013B4DN04({ width: width, height: height }));

    let black = render.makeColor(0, 0, 0);
    let white = render.makeColor(255, 255, 255);

    //let logo = parseBMP(new Resource("moddable-white.bmp"));
    let board = parseBMP(new Resource("board.bmp"));
    //let shade = parseBMP(new Resource("shade.bmp"));
    let font = parseBMF(new Resource("myFont.bf4"));
    //let bell = new Resource("Bag1-1.maud");
    //let four = new Resource("four.maud");

    //let audio = new AudioOut({sampleRate: 24000, bitsPerSample: 16, numChannels: 1, streams: 1});

    //let bonfire = new Resource("Bonfire.maud");
    let audio = new AudioOut({ sampleRate: 44100, bitsPerSample: 16, numChannels: 1, streams: 1 });
    //let audio = new AudioOut({sampleRate: 44100, bitsPerSample: 8, numChannels: 1, streams: 1});

    let percentage = 'unknown';
    let voltage = 'unknown';

    let previous = 0;
    let state = true;
    Timer.repeat(() => {
        const current = button.read();
        if (current !== previous) {
            if (!current) {
                trace("button pressed\n");
                state = !state;
                /*const i2c = new I2C({ sda: 22, scl: 20, address: 0x36, timeout: 50 });
                //i2c.write([0x5400]);
                i2c.write(MAX1704X_SOC_REG);
                let bytes = i2c.read(2);
                let int16 = (bytes[0] << 8) | bytes[1];
                let percent = Math.round((int16 / 256) * 100) / 100;
                i2c.write(MAX1704X_VCELL_REG);
                let bytes2 = i2c.read(2);
                int16 = (bytes2[0] << 8) | bytes2[1];
                let volts = Math.round((int16 * 78.125 / 1000000) * 100) / 100;
                trace(`Percentage ${percent}%`);
                percentage = `Percentage ${percent}% ${bytes[0]} ${bytes[1]}`;
                voltage = `Volts ${volts} ${bytes2[0]} ${bytes2[1]}`;*/

                // Voltage
                //  * 78.125 / 1_000_000
                // percent
                // / 256.0
                // Charge Rate
                //  * 0.208
                //debugger;
                //audio.enqueue(0, AudioOut.Volume, 256);
                //audio.enqueue(0, AudioOut.Samples, bonfire, 2);
                //audio.start();
                const PCA9685_ADDR = 0x40;
                const MODE1 = 0x00;
                const MODE2 = 0x01;
                const PRESCALE = 0xFE;
                const LED0_ON_L = 0x06;

                // Mode 1 bits
                const MODE1_RESTART = 0x80;
                const MODE1_AI = 0x20;
                const MODE1_SLEEP = 0x10;

                // Mode 2 bits
                const MODE2_OUTDRV = 0x04;

                const i2cServo = new I2C({
                    sda: 22,
                    scl: 20,
                    address: PCA9685_ADDR
                });

                function write8(reg, value) {
                    i2cServo.write(Uint8Array.of(reg, value));
                }
                
                function read8(reg) {
                    i2cServo.write(Uint8Array.of(reg));
                    const result = new Uint8Array(1);
                    i2cServo.read(result);
                    return result[0];
                }
/*
                function reset() {
                    // Reset the chip
                    write8(MODE1, MODE1_RESTART);
                    Timer.delay(10);
                    
                    // Setup default mode - Similar to Adafruit implementation
                    write8(MODE1, MODE1_AI); // Auto-increment on
                    Timer.delay(1);
                    
                    // Set totem pole output
                    write8(MODE2, MODE2_OUTDRV);
                }

                function setFrequency() {
                    let prescale = 3;
                    
                    // Read old mode
                    let oldmode = read8(MODE1);
                    
                    // Go to sleep
                    let newmode = (oldmode & ~MODE1_RESTART) | MODE1_SLEEP;
                    write8(MODE1, newmode);
                    
                    // Set prescale
                    write8(PRESCALE, prescale);
                    
                    // Restore old mode
                    write8(MODE1, oldmode);
                    
                    // Wait 500us for oscillator
                    Timer.delay(1);
                    
                    // Restart with auto-increment enabled
                    write8(MODE1, oldmode | MODE1_RESTART | MODE1_AI);
                }

                reset();
                setFrequency();
*/
                /**
                 * Set PWM
                 * @param {number} servoIndex 
                 * @param {number} value 
                 */
                /*function setPWM(servoIndex = 0, value = 0) {
                    const max = 4095;
                    const off = Math.round(max * value);

                    let buffer = new Uint8Array([
                        LED0_ON_L + 4 * servoIndex,
                        0 & 0xFF,
                        (0 >> 8) & 0xFF,
                        off & 0xFF,
                        (off >> 8) & 0xFF
                    ]);
                    i2cServo.write(buffer);
                }*/
/*
                function startSineWave() {
                    let phase = 0;
                    Timer.repeat(() => {
                        // Generate sine wave value (0-4095)
                        let value = (Math.sin(phase) + 1) / 2;
                        
                        // Set PWM value for channel 0
                        setPWM(0, value);
                        
                        // Increment phase (adjust for smoother animation)
                        phase += 2 * Math.PI / 100; // Slower update for more visible effect
                        if (phase >= 2 * Math.PI) phase -= 2 * Math.PI;
                    }, 10); // 10ms interval
                }
                startSineWave();
*/
/*const iterations = 20;
                for (let t = 0; t < FREQUENCY * iterations; ++t) { // Rotate 10 times
                    let signals = generateStepperPWM(t);
                    //trace(Math.round(4095 * signals[0]) + '\n');
                    for (let signalIndex = 0; signalIndex < 4; ++signalIndex) {
                        setPWM(signalIndex, signals[signalIndex]);
                    }
                    Timer.delay(1);
                }*/

                //for (let t = FREQUENCY * iterations; t > 0; --t) { // Rotate -10 times
                //    let signals = generateStepperPWM(t);
                //    for (let signalIndex = 0; signalIndex < 4; ++signalIndex) {
                //        setPWM(signalIndex, signals[signalIndex]);
                //    }
                //    Timer.delay(2);
                //}
                    
            } else {
                trace("button released\n");
            }
            previous = current;
        }
    }, 100);

    //	let sleep = new Sleep();



    let index = 0;

    //	if (Sleep.getWakeupCause() != 3)
    //		index = Sleep.getPersistentValue(0) ? 1 : 0;
    let x = 0;
    let isOdd = true;
    let timer = Timer.repeat(() => {
        index ^= 1;
        render.begin(0, 0, width, height);
        render.fillRectangle(state ? white : black, 0, 0, width, height);
        // Rounded Corners
        if (state) {
            // Top Left
            render.fillRectangle(black, 0, 0, 1, 6);
            render.fillRectangle(black, 1, 0, 1, 3);
            render.fillRectangle(black, 2, 0, 1, 2);
            render.fillRectangle(black, 3, 0, 3, 1);
            // Top Right
            render.fillRectangle(black, 399, 0, 1, 6);
            render.fillRectangle(black, 398, 0, 1, 3);
            render.fillRectangle(black, 397, 0, 1, 2);
            render.fillRectangle(black, 394, 0, 3, 1);
            // Bottom Left
            render.fillRectangle(black, 0, 234, 1, 6);
            render.fillRectangle(black, 1, 237, 1, 3);
            render.fillRectangle(black, 2, 238, 1, 2);
            render.fillRectangle(black, 3, 239, 3, 1);
            // Bottom Right
            render.fillRectangle(black, 399, 234, 1, 6);
            render.fillRectangle(black, 398, 237, 1, 3);
            render.fillRectangle(black, 397, 238, 1, 2);
            render.fillRectangle(black, 394, 239, 3, 1);
        }
        render.drawGray(board, state ? black : white, 0, 0);

        render.drawText(percentage, font, state ? black : white, 10, 198);
        render.drawText(voltage, font, state ? black : white, 10, 220);
        //fillPattern(bits, x, y, w, h [, sx, sy, sw, sh])
        //render.drawGray(shade, state ? black : white, isOdd ? 0 : -1, 0);
        //render.drawGray(logo, state ? black : white, x * 10, 30);
        render.end();
        x++;
        isOdd = !isOdd;
        if (x > 30) {
            x = 0;
        }
    }, SLEEP_MS);


    //	Sleep.setPersistentValue(0, index);
    //	Sleep.sleepEM4(SLEEP_MS);
}