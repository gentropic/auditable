// The AprilTag 36h11 family (AprilRobotics/apriltag, tag36h11.c), GENERATED — never edit by hand. Regenerate from
// the upstream file. The family: 587 codes of 36 bits, a 6 × 6 data grid inside a black ring inside a white ring
// (10 × 10 cells in all; width at the border 8). Its licence, as the source carries it:
/*
Copyright (C) 2013-2016, The Regents of The University of Michigan.
All rights reserved.
This software was developed in the APRIL Robotics Lab under the
direction of Edwin Olson, ebolson@umich.edu. This software may be
available under alternative licensing terms; contact the address above.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
The views and conclusions contained in the software and documentation are those
of the authors and should not be interpreted as representing official policies,
either expressed or implied, of the Regents of The University of Michigan.
*/

export const TAG36H11 = {
  name: 'tag36h11', nbits: 36, totalWidth: 10, widthAtBorder: 8, reversedBorder: false,
  bitX: [1, 2, 3, 4, 5, 2, 3, 4, 3, 6, 6, 6, 6, 6, 5, 5, 5, 4, 6, 5, 4, 3, 2, 5, 4, 3, 4, 1, 1, 1, 1, 1, 2, 2, 2, 3],
  bitY: [1, 1, 1, 1, 1, 2, 2, 2, 3, 1, 2, 3, 4, 5, 2, 3, 4, 3, 6, 6, 6, 6, 6, 5, 5, 5, 4, 6, 5, 4, 3, 2, 5, 4, 3, 4],
  // the codes (36 bits each, as hex: within a double's 53 bits)
  codes: [
    'd7e00984b', 'dda664ca7', 'dc4a1c821', 'e17b470e9', 'ef91d01b1', 'f429cdd73', '05da29225', '1106cba43',
    '223bed79d', '21f51213c', '33eb19ca6', '3f76eb0f8', '469a97414', '45dcfe0b0', '4a6465f72', '51801db96',
    '5eb946b4e', '68a7cc2ec', '6f0ba2652', '78765559d', '87b83d129', '86cc4a5c5', '8b64df90f', '9c577b611',
    'a3810f2f5', 'af4d75b83', 'b59a03fef', 'bb1096f85', 'd1b92fc76', 'd0dd509d2', 'e2cfda160', '2ff497c63',
    '47240671b', '5047a2e55', '635ca87c7', '691254166', '68f43d94a', '6ef24bdb6', '8cdd8f886', '9de96b718',
    'aff6e5a8a', 'bae46f029', 'd225b6d59', 'df8ba8c01', 'e3744a22f', 'fbb59375d', '18a916828', '22f29c1ba',
    '286887d58', '41392322e', '75d18ecd1', '87c302743', '8c6317ba9', '9e40f36d7', 'c0e5a806a', 'cc78cb87c',
    '12d2f2d01', '379f36a21', '6973f59ac', '7789ea9f4', '8f1c73e84', '8dd287a20', '94a4eee4c', 'a455379b5',
    'a9e92987d', 'bd25cb40b', 'be98d3582', 'd3d5972b2', '14c53d7c7', '4f1796936', '4e71fed1a', '66d46fae0',
    'a55abb933', 'ebee1acca', '1ad4ba6a4', '305b17571', '553611351', '59ca62775', '7819cb6a1', 'edb7bc9eb',
    '5b2694212', '72e12d185', 'ed6152e2c', '5bcdadbf3', '78e0aa0c6', 'c60a0b909', 'ef9a34b0d', '398a6621a',
    'a8a27c944', '4b564304e', '52902b4e2', '857280b56', 'a91b2c84b', 'e91df939b', '1fa405f28', '23793ab86',
    '68c17729f', '9fbf3b840', '36922413c', '4eb5f946e', '533fe2404', '63de7d35e', '925eddc72', '99b8b3896',
    'aace4c708', 'c22994af0', '8f1eae41b', 'd95fb486c', '13fb77857', '4fe0983a3', 'd559bf8a9', 'e1855d78d',
    'fec8daaad', '71ecb6d95', 'dc9e50e4c', 'ca3a4c259', '740d12bbf', 'aeedd18e0', 'b509b9c8e', '5232fea1c',
    '19282d18b', '76c22d67b', '936beb34b', '08a5ea8dd', '679eadc28', 'a08e119c5', '20a6e3e24', '7eab9c239',
    '96632c32e', '470d06e44', '8a70212fb', '0a7e4251b', '9ec762cc0', 'd8a3a1f48', 'db680f346', '4a1e93a9d',
    '638ddc04f', '4c2fcc993', '01ef28c95', 'bf0d9792d', '6d27557c3', '623f977f4', '35b43be57', 'bb0c428d5',
    'a6f01474d', '5a70c9749', '20ddabc3b', '2eabd78cf', '90aa18f88', 'a9ea89350', '3cdb39b22', '839a08f34',
    '169bb814e', '1a575ab08', 'a04d3d5a2', 'bf7902f2b', '095a5e65c', '92e8fce94', '67ef48d12', '6400dbcac',
    'b12d8fb9f', '0347f45d3', 'b35826f56', 'c546ac6e4', '81cc35b66', '41d14bd57', '0c052b168', '7d6ce5018',
    'ab4ed5ede', '5af817119', 'd1454b182', '2badb090b', '03fcb4c0c', '2f1c28fd8', '93608c6f7', '4c93ba2b5',
    '07d950a5d', 'e54b3d3fc', '15560cf9d', '189e4958a', '62140e9d2', '723bc1cdb', '2063f26fa', 'fa08ab19f',
    '7955641db', '646b01daa', '71cd427cc', '09a42f7d4', '717edc643', '15eb94367', '8392e6bb2', '832408542',
    '2b9b874be', 'b21f4730d', 'b5d8f24c9', '7dbaf6931', '1b4e33629', '13452e710', 'e974af612', '1df61d29a',
    '99f2532ad', 'e50ec71b4', '5df0a36e8', '4934e4cea', 'e34a0b4bd', 'b7b26b588', '0f255118d', 'd0c8fa31e',
    '06a50c94f', 'f28aa9f06', '131d194d8', '622e3da79', 'ac7478303', 'c8f2521d7', '6c9c881f5', '49e38b60a',
    '513d8df65', 'd7c2b0785', '9f6f9d75a', '9f6966020', '1e1a54e33', 'c04d63419', '946e04cd7', '1bdac5902',
    '56469b830', 'ffad59569', '86970e7d8', '8a4b41e12', 'ad4688e3b', '85f8f5df4', 'd833a0893', '2a36fdd7c',
    'd6a857cf2', '8829bc35c', '5e50d79bc', 'fbb8035e4', 'c1a95bebf', '036b0baf8', 'e0da964ea', 'b6483689b',
    '7c8e2f4c1', '5b856a23b', '2fc183995', 'e914b6d70', 'b31041969', '1bb478493', '063e2b456', 'f2a082b9c',
    '8e5e646ea', '08172f8f6', '0dacd923e', 'e5dcf0e2e', 'bf9446bae', '4822d50d1', '26e710bf5', 'b90ba2a24',
    'f3b25aa73', '809ad589b', '94cc1e254', '5334a3adb', '592886b2f', 'bf64704aa', '566dbf24c', '72203e692',
    '64e61e809', 'd7259aad6', '7b924aedc', '2df2184e8', '353d1eca7', 'fce30d7ce', 'f7b0f436e', '57e8d8f68',
    '8c79e60db', '9c8362b2b', '63a5804f2', '9298353dc', '6f98a71c8', 'a5731f693', '21ca5c870', '1c2107fd3',
    '6181f6c39', '19e574304', '329937606', '043d5c70d', '9b18ff162', '8e2ccfebf', '72b7b9b54', '9b71f4f3c',
    '935d7393e', '65938881a', '6a5bd6f2d', 'a19783306', 'e6472f4d7', '81163df5a', 'a838e1cbd', '982748477',
    '050c54feb', '0d82fbb58', '2c4c72799', '97d259ad6', '22d9a43ed', 'fdb162a9f', '0cb4a727d', '4fae2e371',
    '535b5be8b', '48795908a', 'ce7c18962', '4ea154d80', '50c064889', '8d97fc75d', 'c8bd9ec61', '83ee8e8bb',
    'c8431419a', '1aa78079d', '8111aa4a5', 'dfa3a69fe', '51630d83f', '2d930fb3f', '2133116e5', 'ae5395522',
    'bc07a4e8a', '57bf08ba0', '6cb18036a', 'f0e2e4b75', '3eb692b6f', 'd8178a3fa', '238cce6a6', 'e97d5cdd7',
    'fe10d8d5e', 'b39584a1d', 'ca03536fd', 'aa61f3998', '72ff23ec2', '15aa7d770', '57a3a1282', 'd1f3902dc',
    '6554c9388', 'fd01283c7', 'e8baa42c5', '72cee6adf', 'f6614b3fa', '95c3778a2', '7da4cea7a', 'd18a5912c',
    'd116426e5', '27c17bc1c', 'b95b53bc1', 'c8f937a05', 'ed220c9bd', '0c97d72ab', '8fb1217ae', '25ca8a5a1',
    'b261b871b', '1bef0a056', '806a51179', 'eed249145', '3f82aeceb', 'cc56e9acf', '2e78d01eb', '102cee17f',
    '37caad3d5', '16ac5b1ee', '2af164ece', 'd4cd81dc9', '12263a7e7', '57ac7d117', '9391d9740', '7aedaa77f',
    '9675a3c72', '277f25191', 'ebb6e64b9', '7ad3ef747', '12759b181', '948257d4d', 'b63a850f6', '3a52a8f75',
    '4a019532c', 'a021a7529', 'cc661876d', '4085afd05', 'e7048e089', '3f979cdc6', 'd9da9071b', 'ed2fc5b68',
    '79d64c3a1', 'fd44e2361', '8eea46a74', '42233b9c2', 'ae4d1765d', '7303a094c', '2d7033abe', '3dcc2b0b4',
    '0f0967d09', '06f0cd7de', '09807aca0', '3a295cad3', '2b106b202', '3f38a828e', '78af46596', 'bda2dc713',
    '9a8c8c9d9', '6a0f2ddce', 'a76af6fe2', '086f66fa4', 'd52d63f8d', '89f7a6e73', 'cc6b23362', 'b4ebf3c39',
    '564f300fa', 'e8de3a706', '79a033b61', '765e160c5', 'a266a4f85', 'a68c38c24', 'dca0711fb', '85fba85ba',
    '37a207b46', '158fcc4d0', '0569d79b3', '7b1a25555', 'a8ae22468', '7c592bdfd', '0c59a5f66', 'b1115daa3',
    'f17c87177', '6769d766b', '2b637356d', '13d8685ac', 'f24cb6ec0', '0bd0b56d1', '42ff0e26d', 'b41609267',
    '96f9518af', 'c56f96636', '4a8e10349', '863512171', 'ea455d86c', 'bd0e25279', 'e65e3f761', '36c84a922',
    '85fd1b38f', '657c91539', '15033fe04', '09051c921', 'ab27d80d8', 'f92f7d0a1', '8eb6bb737', '10b5b0f63',
    '6c9c7ad63', 'f66fe70ae', 'ca579bd92', '956198e4d', '29e4405e5', 'e44eb885c', '41612456c', 'ea45e0abf',
    'd326529bd', '7b2c33cef', '80bc9b558', '7169b9740', 'c37f99209', '31ff6dab9', 'c795190ed', 'a7636e95f',
    '9df075841', '55a083932', 'a7cbdf630', '409ea4ef0', '92a1991b6', '4b078dee9', 'ae18ce9e4', '5a6e1ef35',
    '1a403bd59', '31ea70a83', '2bc3c4f3a', '5c921b3cb', '042da05c5', '1f667d16b', '416a368cf', 'fbc0a7a3b',
    '9419f0c7c', '81be2fa03', '34e2c172f', '28648d8ae', 'c7acbb885', '45f31eb6a', 'd1cfc0a7b', '42c4d260d',
    'cf6584097', '94b132b14', '3c5c5df75', '8ae596fef', 'aea8054eb', '0ae9cc573', '496fb731b', 'ebf105662',
    'af9c83a37', 'c0d64cd6b', '7b608159a', 'e74431642', 'd6fb9d900', '291e99de0', '10500ba9a', '5cd05d037',
    'a87254fb2', '9d7824a37', '8b2c7b47c', '30c788145', '2f4e5a8be', 'badb884da', '026e0d5c9', '6fdbaa32e',
    '34758eb31', '565cd1b4f', '2bfd90fb0', '093052a6b', 'd3c13c4b9', '2daea43bf', 'a279762bc', 'f1bd9f22c',
    '4b7fec94f', '545761d5a', '7327df411', '1b52a442e', '49b0ce108', '24c764bc8', '374563045', 'a3e8f91c6',
    '0e6bd2241', 'e0e52ee3c', '07e8e3caa', '96c2b7372', '33acbdfda', 'b15d91e54', '464759ac1', '6886a1998',
    '57f5d3958', '5a1f5c1f5', '0b58158ad', 'e712053fb', '5352ddb25', '414b98ea0', '74f89f546', '38a56b3c3',
    '38db0dc17', 'aa016a755', 'dc72366f5', '0cee93d75', 'b2fe7a56b', 'a847ed390', '8713ef88c', 'a217cc861',
    '8bca25d7b', '455526818', 'ea3a7a180', 'a9536e5e0', '9b64a1975', '5bfc756bc', '046aa169b', '53a17f76f',
    '4d6815274', 'cca9cf3f6', '4013fcb8b', '3d26cdfa5', '5786231f7', '7d4ab09ab', '960b5ffbc', '8914df0d4',
    '2fc6f2213', 'ac235637e', '151b28ed3', '46f79b6db', '1382e0c9f', '53abf983a', '383c47ade', '3fcf88978',
    'eb9079df7', '09af0714d', 'da19d1bb7', '9a02749f8', '1c62dab9b', '1a137e44b', '2867718c7', '35815525b',
    '7cd35c550', '2164f73a0', 'e8b772fe0',
  ],
};

/** a tag's cells, as apriltag_to_image draws them: a totalWidth × totalWidth grid of booleans, true = WHITE */
export function tagCells(fam, id) {
  if (!(id >= 0 && id < fam.codes.length)) throw new Error(`${fam.name}: ids are 0–${fam.codes.length - 1}`);
  const W = fam.totalWidth, code = parseInt(fam.codes[id], 16), g = Array.from({ length: W }, () => new Array(W).fill(false));
  const wb = fam.widthAtBorder + (fam.reversedBorder ? 0 : 2), ws = (W - wb) / 2;   // the 1-cell white ring
  for (let i = 0; i < wb - 1; i++) { g[ws][ws + i] = true; g[ws + i][W - 1 - ws] = true; g[W - 1 - ws][ws + i + 1] = true; g[ws + 1 + i][ws] = true; }
  const bs = (W - fam.widthAtBorder) / 2;
  for (let i = 0; i < fam.nbits; i++) if (Math.floor(code / 2 ** (fam.nbits - i - 1)) % 2 === 1) g[fam.bitY[i] + bs][fam.bitX[i] + bs] = true;
  return g;
}
