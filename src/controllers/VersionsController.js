import { Controller }  from './Controller'
import {$} from 'bun'
export class VersionsController extends Controller{

    /**
     * Read all versions and return the
     *
     * @return json cotent
     */
    versions = async () => {
        const backend = await Bun.file(this.setBackendFilePath('version.json')).json()
       const studio =  await Bun.file(this.setStudioFilePath('version.json')).json()
       return  {...studio,...backend}
    }

}