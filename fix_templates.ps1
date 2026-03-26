$utf8NoBom = New-Object System.Text.UTF8Encoding $false

function ReadFile($path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $bytes = $bytes[3..($bytes.Length-1)]
    }
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function SaveFile($path, $content) {
    [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Fix($path, $old, $new) {
    $c = ReadFile $path
    $c2 = $c.Replace($old, $new)
    if ($c2 -ne $c) { SaveFile $path $c2; Write-Host "fixed: $path" }
    else { Write-Host "no match in: $path -- '$old'" }
}

# crop.html
Fix 'templates/tools/crop.html' `
    '<button class="btn-download" id="btn-download"><i data-lucide="download"></i> Download</button>' `
    '<button class="btn-download" id="btn-download"><i data-lucide="download"></i> {{ t.btn_download }}</button>'

# effects.html
Fix 'templates/tools/effects.html' `
    'Effects applied</div>' `
    '{{ t.label_effects_applied }}</div>'
Fix 'templates/tools/effects.html' `
    '<div class="ba-label" style="margin-bottom:0.4rem">Preview</div>' `
    '<div class="ba-label" style="margin-bottom:0.4rem">{{ t.label_preview }}</div>'

# resize.html - note: use em dash
Fix 'templates/tools/resize.html' `
    'Live Preview' `
    '{{ t.label_live_preview }}'

# gif-maker.html
Fix 'templates/tools/gif-maker.html' `
    'value="custom"> Custom:' `
    'value="custom"> {{ t.label_custom }}:'
Fix 'templates/tools/gif-maker.html' `
    'margin-bottom:0.5rem">Preview</div>' `
    'margin-bottom:0.5rem">{{ t.label_preview }}</div>'
Fix 'templates/tools/gif-maker.html' `
    ' Download GIF</button>' `
    ' {{ t.btn_download_gif }}</button>'

# gif-editor.html
Fix 'templates/tools/gif-editor.html' `
    'Transform all</span>' `
    '{{ t.label_transform_all }}</span>'
Fix 'templates/tools/gif-editor.html' `
    '></i> Crop</button>' `
    '></i> {{ t.btn_crop }}</button>'
Fix 'templates/tools/gif-editor.html' `
    '<label>Width</label>' `
    '<label>{{ t.label_width }}</label>'
Fix 'templates/tools/gif-editor.html' `
    '<label>Height</label>' `
    '<label>{{ t.label_height }}</label>'
Fix 'templates/tools/gif-editor.html' `
    ';margin:0">Apply Crop</button>' `
    ';margin:0">{{ t.btn_apply_crop }}</button>'
Fix 'templates/tools/gif-editor.html' `
    'cursor:pointer">Cancel</button>' `
    'cursor:pointer">{{ t.btn_cancel }}</button>'
Fix 'templates/tools/gif-editor.html' `
    'drag handles, then click Apply' `
    '{{ t.label_gif_editor_crop_hint }}'
Fix 'templates/tools/gif-editor.html' `
    'margin-bottom:0.4rem">Preview</div>' `
    'margin-bottom:0.4rem">{{ t.label_preview }}</div>'
Fix 'templates/tools/gif-editor.html' `
    '<option value="1">1 time</option>' `
    '<option value="1">{{ t.label_loop_1x }}</option>'
Fix 'templates/tools/gif-editor.html' `
    '<option value="2">2 times</option>' `
    '<option value="2">{{ t.label_loop_2x }}</option>'
Fix 'templates/tools/gif-editor.html' `
    '<option value="3">3 times</option>' `
    '<option value="3">{{ t.label_loop_3x }}</option>'
Fix 'templates/tools/gif-editor.html' `
    '<option value="5">5 times</option>' `
    '<option value="5">{{ t.label_loop_5x }}</option>'
Fix 'templates/tools/gif-editor.html' `
    ' Download</button>' `
    ' {{ t.btn_download }}</button>'

# gif-to-mp4.html
Fix 'templates/tools/gif-to-mp4.html' `
    '>Loading FFmpeg' `
    '>{{ t.label_loading_ffmpeg }}'
Fix 'templates/tools/gif-to-mp4.html' `
    'margin-bottom:0.5rem">Result</div>' `
    'margin-bottom:0.5rem">{{ t.label_result }}</div>'
Fix 'templates/tools/gif-to-mp4.html' `
    ' Download MP4</button>' `
    ' {{ t.btn_download_mp4 }}</button>'

# gif-to-webm.html
Fix 'templates/tools/gif-to-webm.html' `
    '>Loading FFmpeg' `
    '>{{ t.label_loading_ffmpeg }}'
Fix 'templates/tools/gif-to-webm.html' `
    'margin-bottom:0.5rem">Result</div>' `
    'margin-bottom:0.5rem">{{ t.label_result }}</div>'
Fix 'templates/tools/gif-to-webm.html' `
    ' Download WebM</button>' `
    ' {{ t.btn_download_webm }}</button>'

# gif-to-mov.html
Fix 'templates/tools/gif-to-mov.html' `
    '>Loading FFmpeg' `
    '>{{ t.label_loading_ffmpeg }}'
Fix 'templates/tools/gif-to-mov.html' `
    'Preview is not available for MOV format in most browsers. Your file is ready to download.' `
    '{{ t.label_mov_no_preview }}'
Fix 'templates/tools/gif-to-mov.html' `
    ' Download MOV</button>' `
    ' {{ t.btn_download_mov }}</button>'

# video-to-gif.html
Fix 'templates/tools/video-to-gif.html' `
    'Max 30s recommended</span>' `
    '{{ t.label_max_30s }}</span>'
Fix 'templates/tools/video-to-gif.html' `
    '>Loading FFmpeg' `
    '>{{ t.label_loading_ffmpeg }}'
Fix 'templates/tools/video-to-gif.html' `
    'margin-bottom:0.5rem">Result</div>' `
    'margin-bottom:0.5rem">{{ t.label_result }}</div>'
Fix 'templates/tools/video-to-gif.html' `
    ' Download GIF</button>' `
    ' {{ t.btn_download_gif }}</button>'

# gif-analyzer.html
Fix 'templates/tools/gif-analyzer.html' `
    '<tr><th>#</th><th>Preview</th><th>Delay</th></tr>' `
    '<tr><th>#</th><th>{{ t.label_preview }}</th><th>{{ t.label_delay }}</th></tr>'

Write-Host "All done!"
