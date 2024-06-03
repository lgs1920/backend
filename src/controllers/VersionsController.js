import { Controller }  from './Controller'

export class VersionsController extends Controller{

    /**
     * Read all versions and return them
     *
     * @return json cotent
     */
    versions = async () => {
        const backend = await Bun.file('./version.json').json()
        const studio =  await Bun.file(this.setPublicName('version.json')).json()
        return  {...studio,...backend}
    }

}