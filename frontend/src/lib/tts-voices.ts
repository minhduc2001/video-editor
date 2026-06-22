export const TTS_VOICE_GROUPS = [
  {
    label: 'VieNeu Vietnamese (local or remote)',
    voices: [
      { value: 'vieneu:Bình An', label: 'Bình An - default natural voice' },
      { value: 'vieneu:Xuân Vĩnh', label: 'Xuân Vĩnh - preset voice' },
      { value: 'vieneu:Ngọc Linh', label: 'Ngọc Linh - preset voice' },
    ],
  },
  {
    label: 'OpenAI Natural Vietnamese (needs OpenAI key)',
    voices: [
      { value: 'openai:marin', label: 'Marin - warm natural narrator' },
      { value: 'openai:cedar', label: 'Cedar - calm grounded narrator' },
      { value: 'openai:coral', label: 'Coral - bright friendly female' },
      { value: 'openai:verse', label: 'Verse - youthful social style' },
      { value: 'openai:nova', label: 'Nova - clear modern female' },
      { value: 'openai:shimmer', label: 'Shimmer - soft polished female' },
    ],
  },
  {
    label: 'Microsoft Edge Vietnamese (free)',
    voices: [
      { value: 'vi-VN-HoaiMyNeural', label: 'HoaiMy - Vietnamese female' },
      { value: 'vi-VN-NamMinhNeural', label: 'NamMinh - Vietnamese male' },
    ],
  },
  {
    label: 'Other Edge test voices',
    voices: [
      { value: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao - Chinese female' },
      { value: 'zh-CN-YunxiNeural', label: 'Yunxi - Chinese male' },
      { value: 'en-US-JennyNeural', label: 'Jenny - English female' },
      { value: 'en-US-GuyNeural', label: 'Guy - English male' },
    ],
  },
];
