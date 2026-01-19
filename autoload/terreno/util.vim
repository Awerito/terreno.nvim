let s:terreno_root_dir = expand('<sfile>:h:h:h')

function! s:on_exit(autoclose, bufnr, Callback, job_id, status, ...)
  let content = join(getbufline(a:bufnr, 1, '$'), "\n")
  if a:status == 0 && a:autoclose == 1
    execute 'silent! bd! '.a:bufnr
  endif
  if !empty(a:Callback)
    call call(a:Callback, [a:status, a:bufnr, content])
  endif
endfunction

function! s:terreno_installed(status, ...) abort
  if a:status != 0
    echohl Error | echo '[terreno.nvim]: install failed' | echohl None
    return
  endif
  echo '[terreno.nvim]: install completed'
endfunction

function! terreno#util#open_terminal(opts) abort
  execute 'belowright 5new +setl\ buftype=nofile'
  setl buftype=nofile
  setl winfixheight
  setl norelativenumber
  setl nonumber
  setl bufhidden=wipe
  let cmd = get(a:opts, 'cmd', '')
  let autoclose = get(a:opts, 'autoclose', 1)
  let cwd = get(a:opts, 'cwd', '')
  if !empty(cwd) | execute 'lcd '.cwd | endif
  let bufnr = bufnr('%')
  let Callback = get(a:opts, 'Callback', v:null)
  call termopen(cmd, {
        \ 'on_exit': function('s:on_exit', [autoclose, bufnr, Callback]),
        \})
  wincmd p
  return bufnr
endfunction

function! terreno#util#install()
  call terreno#util#open_terminal({
        \ 'cmd': './install.sh',
        \ 'cwd': s:terreno_root_dir . '/app',
        \ 'Callback': function('s:terreno_installed')
        \})
endfunction
