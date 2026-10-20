// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const auth=vi.hoisted(()=>({
  getSession:vi.fn(async()=>({data:{session:null}})),
  onAuthStateChange:vi.fn(()=>({data:{subscription:{unsubscribe:vi.fn()}}})),
  signInWithOtp:vi.fn(async()=>({error:null})),
}));
vi.mock('../src/lib/supabase.js',()=>({supabase:{auth}}));
vi.mock('../src/hooks/useProjectData.jsx',()=>({useProjectData:()=>({isDemo:false,status:'ready',project:{id:'project'},parts:[],reload:vi.fn()})}));
import Admin from '../src/pages/Admin.jsx';
afterEach(()=>{cleanup();vi.clearAllMocks();window.history.replaceState(null,'','/admin');});
it('requests an owner email link without creating another account or collecting a password',async()=>{
  render(<Admin/>);
  const email=await screen.findByLabelText('Email');
  fireEvent.change(email,{target:{value:'owner@example.com'}});
  fireEvent.click(screen.getByRole('button',{name:'Email sign-in link'}));
  await waitFor(()=>expect(auth.signInWithOtp).toHaveBeenCalledWith({email:'owner@example.com',options:{emailRedirectTo:`${window.location.origin}/admin`,shouldCreateUser:false}}));
  expect(await screen.findByRole('status')).toHaveTextContent('Check your email');
  expect(screen.getByRole('button',{name:'Send again in 60s'})).toBeDisabled();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
});
it('explains an expired callback safely and removes the failed fragment',async()=>{
  window.history.replaceState(null,'','/admin#error=access_denied&error_code=otp_expired&error_description=%3Cscript%3Euntrusted%3C%2Fscript%3E');
  render(<Admin/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Use the newest email');
  expect(screen.queryByText(/untrusted/)).not.toBeInTheDocument();
  expect(window.location.hash).toBe('');
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
});
